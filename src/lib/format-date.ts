// One date vocabulary for the whole app. Absolute dates are short and
// British ("14 Sep"); moments that matter this week are relative ("Yesterday",
// "Thu 25 Sep, 23:59"). Nothing shows seconds, and no view uses the
// browser's locale default, which differs between server and client.

const DAY_MS = 86_400_000;

const startOfDay = (ms: number) => {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/** "14 Sep" — announcements, generated-at stamps, file dates. */
export function shortDate(ms: number): string {
  return new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/** "14:02" — a time on the current day. */
export function shortTime(ms: number): string {
  return new Date(ms).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

/** "Today" / "Yesterday" / "Mon" (within the week) / "14 Sep" — for things that happened. */
export function relativeDay(ms: number, now: number): string {
  const days = Math.round((startOfDay(now) - startOfDay(ms)) / DAY_MS);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days > 1 && days < 7) return new Date(ms).toLocaleDateString("en-GB", { weekday: "short" });
  return shortDate(ms);
}

/** "Today, 23:59" / "Thu 25 Sep, 23:59" / "14 Sep, 09:00" — for things that are due. */
export function dueLabel(ms: number, now: number): string {
  const days = Math.round((startOfDay(ms) - startOfDay(now)) / DAY_MS);
  const time = shortTime(ms);
  if (days === 0) return `Today, ${time}`;
  if (days === 1) return `Tomorrow, ${time}`;
  if (days > 1 && days < 7) return `${new Date(ms).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}, ${time}`;
  return `${shortDate(ms)}, ${time}`;
}

/** "synced 14:02" today, else "synced Yesterday" / "synced 14 Sep" — for sync stamps. */
export function syncedLabel(ms: number, now: number): string {
  return startOfDay(ms) === startOfDay(now) ? shortTime(ms) : relativeDay(ms, now);
}
