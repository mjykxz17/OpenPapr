import { existsSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { lt } from "drizzle-orm";
import type { Db } from "../db/client";
import { syncRuns } from "../db/schema";

// Housekeeping the worker does a few times a day, so a semester of use does
// not slowly fill the 3GB volume or bloat the tables every page reads.

type Entry = { path: string; size: number; used: number };

function walk(dir: string, out: Entry[]): void {
  let names: string[];
  try { names = readdirSync(dir); } catch { return; }
  for (const n of names) {
    const p = join(dir, n);
    let s;
    try { s = statSync(p); } catch { continue; }
    if (s.isDirectory()) walk(p, out);
    else out.push({ path: p, size: s.size, used: Math.max(s.atimeMs, s.mtimeMs) });
  }
}

// Least-recently-used eviction across the file caches. Everything in them can
// be fetched from Canvas again, so the only cost of evicting is one slower
// open. Half-written ".part" files older than an hour are debris from an
// interrupted download and always go.
export function evictCaches(roots: string[], maxBytes: number, now = Date.now()): { removed: number; freed: number; total: number } {
  const all: Entry[] = [];
  for (const r of roots) if (existsSync(r)) walk(r, all);
  let removed = 0, freed = 0;
  const keep: Entry[] = [];
  for (const e of all) {
    if (e.path.endsWith(".part") && now - e.used > 3_600_000) {
      try { rmSync(e.path, { force: true }); removed++; freed += e.size; } catch { /* in use */ }
    } else keep.push(e);
  }
  let total = keep.reduce((n, e) => n + e.size, 0);
  keep.sort((a, b) => a.used - b.used);
  for (const e of keep) {
    if (total <= maxBytes) break;
    try { rmSync(e.path, { force: true }); removed++; freed += e.size; total -= e.size; } catch { /* in use */ }
  }
  return { removed, freed, total };
}

// Serving a cached file does not update its access time on a volume mounted
// noatime, so readers mark use explicitly.
export function touch(path: string): void {
  try { const t = new Date(); utimesSync(path, t, t); } catch { /* best effort */ }
}

export function pruneSyncRuns(db: Db, now: number, keepMs = 7 * 86_400_000): number {
  return db.delete(syncRuns).where(lt(syncRuns.startedAt, now - keepMs)).run().changes;
}

// The worker's pulse, written to a file beside the database so the web
// server can report whether background work is alive without a DB write.
export function writeHeartbeat(path: string, now = Date.now()): void {
  try { writeFileSync(path, String(now)); } catch { /* read-only disk: nothing to do */ }
}
