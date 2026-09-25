// When OpenPapr checks Canvas. Through the day and evening every user is
// synced every base interval (5 minutes by default); between 1am and 7am
// Singapore time, when nobody is reading and courses rarely post, once an
// hour. Opening the app syncs on the spot if the last sync is more than a
// couple of minutes old, so what a student sees is fresh either way.

const H = 3_600_000;
const QUIET_FROM = 1;  // 01:00 SGT
const QUIET_TO = 7;    // 07:00 SGT
export const QUIET_INTERVAL_MS = H;
export const SYNC_ON_OPEN_AFTER_MS = 2 * 60_000;

export const sgtHour = (ms: number) => new Date(ms + 8 * H).getUTCHours();
export const isQuietHour = (ms: number) => sgtHour(ms) >= QUIET_FROM && sgtHour(ms) < QUIET_TO;

export function pollIntervalAt(now: number, baseMs: number): number {
  return isQuietHour(now) ? Math.max(baseMs, QUIET_INTERVAL_MS) : baseMs;
}

// A source is stale after three missed syncs — counted against the slower
// night schedule for the first hour after it ends, so 7am is not a false alarm.
export function staleAfterMs(now: number, baseMs: number): number {
  return 3 * Math.max(pollIntervalAt(now, baseMs), pollIntervalAt(now - H, baseMs));
}
