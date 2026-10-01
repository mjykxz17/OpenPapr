// "Remind me to email Prof Tan about CS4238 by Friday" → a task. Plain rules,
// no model: it has to work on the shared key's last call of the month too,
// and it must never guess a date the student did not say.

const H = 3_600_000;
const D = 24 * H;
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

const LEAD = /^\s*(?:hey\s+papi[,!]?\s*|papi[,!]?\s*)?(?:(?:can|could)\s+you\s+)?(?:please\s+)?(?:remind\s+me\s+(?:to\s+|about\s+|that\s+)?|add\s+(?:a\s+)?(?:task|todo|to-do|reminder)\s*(?::|to\s+|for\s+)?|(?:new\s+)?(?:task|todo|to-do|reminder)\s*:\s*|note\s+to\s+self\s*:?\s*)/i;

export function isAddRequest(text: string): boolean {
  return LEAD.test(text) && text.replace(LEAD, "").trim().length >= 2;
}

export type QuickAdd = { title: string; day: string | null; moduleCode: string | null };

const sgtDay = (ms: number) => new Date(ms + 8 * H).toISOString().slice(0, 10);
const sgtWeekday = (ms: number) => new Date(ms + 8 * H).getUTCDay();
const addDays = (ms: number, n: number) => sgtDay(ms + n * D);

// The day the words name, as YYYY-MM-DD in Singapore, and the words removed.
function findDay(text: string, now: number): { day: string; rest: string } | null {
  const tries: [RegExp, (m: RegExpExecArray) => string | null][] = [
    [/\b(?:by|on|before|due)?\s*(?:today|tonight|this\s+evening)\b/i, () => sgtDay(now)],
    [/\b(?:by|on|before|due)?\s*(?:tomorrow|tmr|tmrw)\b/i, () => addDays(now, 1)],
    [/\b(?:by|on|before|due)?\s*(?:the\s+)?day\s+after\s+tomorrow\b/i, () => addDays(now, 2)],
    [/\bin\s+(\d{1,2})\s+days?\b/i, (m) => addDays(now, Number(m[1]))],
    [/\bin\s+(?:a|one)\s+week\b|\bnext\s+week\b/i, () => addDays(now, 7)],
    [/\b(?:by|on|before|due)?\s*(next\s+|this\s+)?(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)(?:day|nesday|sday|urday)?\b/i, (m) => {
      const want = WEEKDAYS.findIndex((w) => w.startsWith(m[2]!.toLowerCase().slice(0, 3)));
      let diff = (want - sgtWeekday(now) + 7) % 7;
      if (diff === 0) diff = 7;                       // "Friday" on a Friday means next Friday
      if (m[1]?.toLowerCase().startsWith("next") && diff < 7) diff += 7;
      return addDays(now, diff);
    }],
    [/\b(?:by|on|before|due)?\s*(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b/i, (m) => dayFrom(Number(m[1]), MONTHS.indexOf(m[2]!.toLowerCase().slice(0, 3)), now)],
    [/\b(?:by|on|before|due)?\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+(\d{1,2})(?:st|nd|rd|th)?\b/i, (m) => dayFrom(Number(m[2]), MONTHS.indexOf(m[1]!.toLowerCase().slice(0, 3)), now)],
    // Singapore writes day first: 3/10 is the 3rd of October.
    [/\b(?:by|on|before|due)?\s*(\d{1,2})\/(\d{1,2})\b/, (m) => dayFrom(Number(m[1]), Number(m[2]) - 1, now)],
  ];
  for (const [re, fn] of tries) {
    const m = re.exec(text);
    if (!m) continue;
    const day = fn(m);
    if (!day) continue;
    return { day, rest: (text.slice(0, m.index) + " " + text.slice(m.index + m[0].length)) };
  }
  return null;
}

// The next such date from today (a date already past this year means next year).
function dayFrom(date: number, month: number, now: number): string | null {
  if (month < 0 || month > 11 || date < 1 || date > 31) return null;
  const year = Number(sgtDay(now).slice(0, 4));
  for (const y of [year, year + 1]) {
    const iso = `${y}-${String(month + 1).padStart(2, "0")}-${String(date).padStart(2, "0")}`;
    const t = Date.parse(`${iso}T12:00:00+08:00`);
    if (Number.isNaN(t) || sgtDay(t) !== iso) return null;        // 31 Sep
    if (iso >= sgtDay(now)) return iso;
  }
  return null;
}

export function parseQuickAdd(text: string, codes: string[], now: number): QuickAdd {
  let rest = text.replace(LEAD, "");
  const found = findDay(rest, now);
  const day = found?.day ?? null;
  if (found) rest = found.rest;
  // Times are noise for a day-level task; drop "at 5pm" so it does not stay in the title.
  rest = rest.replace(/\b(?:at|by)\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?\b|\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/gi, " ");
  const code = codes.find((c) => new RegExp(`\\b${c.replace(/[^A-Za-z0-9]/g, "")}\\b`, "i").test(rest.replace(/\s+/g, " "))) ?? null;
  const title = rest.replace(/\s+/g, " ").replace(/\s+([,.!?])/g, "$1").replace(/^[\s,:-]+|[\s,.!:-]+$/g, "").replace(/\b(?:by|on|before|due)$/i, "").trim();
  return { title: title ? title[0]!.toUpperCase() + title.slice(1) : "", day, moduleCode: code };
}
