// A minimal iCalendar (RFC 5545) writer for the student's private feed:
// timed events, all-day events, escaping and line folding. Nothing else.

export type CalEvent =
  | { uid: string; title: string; description?: string; url?: string | null; start: number; end: number; allDay?: false }
  | { uid: string; title: string; description?: string; url?: string | null; date: string; allDay: true }; // date: YYYY-MM-DD

const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const utc = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const day = (d: string) => d.replace(/-/g, "");
const nextDay = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

// Lines longer than 75 octets continue on the next line after a space.
function fold(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const out: string[] = [];
  let cur = "", n = 0;
  for (const ch of line) {
    const len = new TextEncoder().encode(ch).length;
    if (n + len > (out.length ? 74 : 75)) { out.push(cur); cur = ""; n = 0; }
    cur += ch; n += len;
  }
  out.push(cur);
  return out.join("\r\n ");
}

export function buildIcs(name: string, events: CalEvent[], now: number): string {
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//OpenPapr//Deadlines//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    `X-WR-CALNAME:${esc(name)}`, "X-WR-TIMEZONE:Asia/Singapore", "REFRESH-INTERVAL;VALUE=DURATION:PT1H", "X-PUBLISHED-TTL:PT1H",
  ];
  for (const e of events) {
    lines.push("BEGIN:VEVENT", `UID:${e.uid}`, `DTSTAMP:${utc(now)}`);
    if (e.allDay) lines.push(`DTSTART;VALUE=DATE:${day(e.date)}`, `DTEND;VALUE=DATE:${day(nextDay(e.date))}`, "TRANSP:TRANSPARENT");
    else lines.push(`DTSTART:${utc(e.start)}`, `DTEND:${utc(e.end)}`);
    lines.push(`SUMMARY:${esc(e.title)}`);
    if (e.description) lines.push(`DESCRIPTION:${esc(e.description)}`);
    if (e.url) lines.push(`URL:${e.url}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
