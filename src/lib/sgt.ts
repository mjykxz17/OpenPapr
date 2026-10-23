// Singapore time, the one zone OpenPapr runs on. Every day it plans, files a
// deadline under or shows is a Singapore day, whatever zone the server or the
// browser happens to be in. Singapore is UTC+8 all year, with no daylight
// saving, so shifting by a fixed eight hours is exact.
//
// The trick throughout: add the offset and read the UTC fields, which then
// say what a clock in Singapore says.

export const SGT_ZONE = "Asia/Singapore";
export const SGT_OFFSET_MS = 8 * 3_600_000;
const D = 86_400_000;
const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** A Date whose UTC fields (getUTCHours, getUTCDay, toISOString…) read Singapore's clock. */
export const sgtClock = (ms: number) => new Date(ms + SGT_OFFSET_MS);
/** "2026-10-30": the Singapore day `ms` falls on. */
export const sgtDate = (ms: number) => sgtClock(ms).toISOString().slice(0, 10);
/** "2026-10" */
export const sgtMonth = (ms: number) => sgtClock(ms).toISOString().slice(0, 7);
/** "14:05" */
export const sgtHHMM = (ms: number) => sgtClock(ms).toISOString().slice(11, 16);
/** 0–23 */
export const sgtHour = (ms: number) => sgtClock(ms).getUTCHours();
/** 0 = Sunday */
export const sgtWeekday = (ms: number) => sgtClock(ms).getUTCDay();
/** "Fri 30 Oct" */
export const sgtDayLabel = (ms: number) => { const d = sgtClock(ms); return `${WEEKDAY[d.getUTCDay()]} ${d.getUTCDate()} ${MONTH[d.getUTCMonth()]}`; };
/** The midnight that starts `ms`'s Singapore day. */
export const sgtMidnight = (ms: number) => Math.floor((ms + SGT_OFFSET_MS) / D) * D - SGT_OFFSET_MS;
/** One number per Singapore day (days since 1 Jan 1970 there), for grouping by day. */
export const sgtDayNumber = (ms: number) => Math.floor((ms + SGT_OFFSET_MS) / D);

/** "14:00" on Singapore day "2026-10-30", as a timestamp. NaN if unreadable. */
export const sgtTime = (day: string, hhmm = "00:00") => Date.parse(`${day}T${hhmm}:00+08:00`);
/** Noon on a Singapore day: whole days can be added to it and read back with sgtDate. */
export const sgtNoon = (day: string) => sgtTime(day, "12:00");
/** The end of that day in Singapore: "due Friday" means by Friday night. */
export const endOfSgtDay = (day: string) => sgtTime(day, "23:59");
/** A time on a Singapore day; without one, by the end of it. */
export const sgtAt = (day: string, hhmm: string | null | undefined) => (hhmm ? sgtTime(day, hhmm) : endOfSgtDay(day));
/** The Singapore day `n` days after (or before) `day`. */
export const addSgtDays = (day: string, n: number) => sgtDate(sgtNoon(day) + n * D);

// A date or time from a model, read as Singapore time whatever the server's
// zone: "2026-10-30" is by the end of that day (23:59), "2026-10-30T14:00"
// is 2pm there, and anything with its own offset keeps it. NaN if unreadable.
export function parseSgt(s: string): number {
  const t = s.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return endOfSgtDay(t);
  const local = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(:\d{2}(\.\d+)?)?$/.exec(t);
  if (local) return Date.parse(`${local[1]}T${local[2]}${local[3] ?? ":00"}+08:00`);
  return Date.parse(t);
}
// "2026-10-30 14:05 (Fri)" in Singapore time, for prompts.
export const sgtStamp = (ms: number) => {
  const d = sgtClock(ms);
  return `${d.toISOString().slice(0, 16).replace("T", " ")} (${WEEKDAY[d.getUTCDay()]})`;
};
