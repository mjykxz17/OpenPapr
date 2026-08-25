// Fixed-window limiter, in memory. The app runs as a single Next server
// process, so one map is the whole picture; if this ever runs on more than one
// machine it must move into the database.
type Window = { count: number; resetAt: number };
const windows = new Map<string, Window>();

export function rateLimit(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
  const w = windows.get(key);
  if (!w || now >= w.resetAt) {
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (w.count >= limit) return false;
  w.count++;
  return true;
}

// Drops windows that have already expired. Called opportunistically so the map
// cannot grow without bound across many distinct client addresses.
export function pruneRateLimits(now = Date.now()): void {
  for (const [k, w] of windows) if (now >= w.resetAt) windows.delete(k);
}

export function resetRateLimits(): void {
  windows.clear();
}
