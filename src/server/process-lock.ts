import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

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

export class LockTimeoutError extends Error {}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type ProcessLock = {
  // Runs `work` while holding the lock; waits up to `maxWaitMs` for it.
  run<T>(work: () => Promise<T>, opts?: { maxWaitMs?: number; pollMs?: number }): Promise<T>;
  close(): void;
};

export function processLock(path: string): ProcessLock {
  let conn: Database.Database | null = null;
  const open = () => {
    if (conn) return conn;
    mkdirSync(dirname(path), { recursive: true });
    conn = new Database(path);
    conn.pragma("busy_timeout = 0");   // never block the event loop
    return conn;
  };
  // Within one process, callers queue here first: only one of them is ever
  // waiting on the file at a time.
  let queue: Promise<unknown> = Promise.resolve();

  async function acquire(maxWaitMs: number, pollMs: number): Promise<Database.Database> {
    const db = open();
    const giveUpAt = Date.now() + maxWaitMs;
    for (;;) {
      try {
        db.exec("BEGIN IMMEDIATE");
        return db;
      } catch (err) {
        if ((err as { code?: string }).code !== "SQLITE_BUSY") throw err;
        if (Date.now() >= giveUpAt) throw new LockTimeoutError(`${path} is busy`);
        await sleep(pollMs);
      }
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
