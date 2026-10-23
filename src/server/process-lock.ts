import Database from "better-sqlite3";
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

// A lock shared by every process on the machine — the web server and the
// worker — for work that must not run twice at once, like a LibreOffice
// conversion (a few hundred MB each, on a 1GB machine).
//
// It is SQLite's own file lock on a small file of its own: whoever holds a
// BEGIN IMMEDIATE on it has the lock. The operating system drops that lock
// when its process dies, however it dies, so a crash or an out-of-memory kill
// can never leave a stale lock behind, and there is no PID or age to guess
// at. Taking it never blocks: a busy lock is retried after a short sleep, so
// a page being served is not held up by the wait.
//
// It takes turns. A process with a backlog would otherwise take the lock back
// the moment it let go, while the other one sleeps between tries — the worker
// converting a guide's worth of decks would keep a viewer waiting until it
// gave up. So a waiter leaves a marker file while it waits, and the last
// holder, finding one, stands back until that waiter has had its go.

export class LockTimeoutError extends Error {}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// A marker not touched for this long belongs to a waiter that has gone.
const markerFreshMs = (pollMs: number) => Math.max(5_000, 4 * pollMs);
// The longest the last holder stands back for a waiter that never comes.
const MAX_YIELD_MS = 10_000;

export type ProcessLock = {
  // Runs `work` while holding the lock; waits up to `maxWaitMs` for it.
  run<T>(work: () => Promise<T>, opts?: { maxWaitMs?: number; pollMs?: number }): Promise<T>;
  close(): void;
};

export function processLock(path: string): ProcessLock {
  // Who this is, in the marker and holder files: a pid alone can repeat.
  const me = `${process.pid}-${randomBytes(4).toString("hex")}`;
  const dir = dirname(path);
  const markerPrefix = `${basename(path)}.wait-`;
  const myMarker = join(dir, `${markerPrefix}${me}`);
  const holderFile = `${path}.last`;

  let conn: Database.Database | null = null;
  const open = () => {
    if (conn) return conn;
    mkdirSync(dir, { recursive: true });
    conn = new Database(path);
    conn.pragma("busy_timeout = 0");   // never block the event loop
    return conn;
  };
  // Within one process, callers queue here first: only one of them is ever
  // waiting on the file at a time.
  let queue: Promise<unknown> = Promise.resolve();

  const lastHolder = (): string | null => {
    try { return readFileSync(holderFile, "utf8"); } catch { return null; }
  };
  // Someone else is waiting for the lock right now.
  function othersWaiting(pollMs: number): boolean {
    let names: string[];
    try { names = readdirSync(dir); } catch { return false; }
    const now = Date.now();
    for (const name of names) {
      if (!name.startsWith(markerPrefix) || name === basename(myMarker)) continue;
      const full = join(dir, name);
      try {
        const age = now - statSync(full).mtimeMs;
        if (age < markerFreshMs(pollMs)) return true;
        if (age > 60_000) rmSync(full, { force: true });   // left by a process that died waiting
      } catch { /* gone meanwhile */ }
    }
    return false;
  }
  function markWaiting(): void {
    try {
      const t = new Date();
      try { utimesSync(myMarker, t, t); } catch { writeFileSync(myMarker, ""); }
    } catch { /* taking turns is a courtesy; the lock itself still holds */ }
  }

  async function acquire(maxWaitMs: number, pollMs: number): Promise<Database.Database> {
    const db = open();
    const startedAt = Date.now();
    const giveUpAt = startedAt + maxWaitMs;
    try {
      for (;;) {
        // The last holder lets a waiter go first, for a while at most.
        const standBack = Date.now() - startedAt < MAX_YIELD_MS && lastHolder() === me && othersWaiting(pollMs);
        if (!standBack) {
          try {
            db.exec("BEGIN IMMEDIATE");
            try { writeFileSync(holderFile, me); } catch { /* see markWaiting */ }
            return db;
          } catch (err) {
            if ((err as { code?: string }).code !== "SQLITE_BUSY") throw err;
          }
        }
        if (Date.now() >= giveUpAt) throw new LockTimeoutError(`${path} is busy`);
        markWaiting();
        await sleep(pollMs);
      }
    } finally {
      rmSync(myMarker, { force: true });
    }
  }

  return {
    run<T>(work: () => Promise<T>, opts: { maxWaitMs?: number; pollMs?: number } = {}): Promise<T> {
      const { maxWaitMs = 10 * 60_000, pollMs = 500 } = opts;
      const turn = queue.then(async () => {
        const db = await acquire(maxWaitMs, pollMs);
        try {
          return await work();
        } finally {
          try { db.exec("ROLLBACK"); } catch { /* nothing was written */ }
        }
      });
      queue = turn.catch(() => undefined);
      return turn;
    },
    close() { conn?.close(); conn = null; },
  };
}
