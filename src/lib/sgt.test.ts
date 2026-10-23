import { describe, expect, it } from "vitest";
import {
  addSgtDays, endOfSgtDay, parseSgt, SGT_ZONE, sgtAt, sgtClock, sgtDate, sgtDayLabel, sgtDayNumber, sgtHHMM, sgtHour,
  sgtMidnight, sgtMonth, sgtNoon, sgtStamp, sgtTime, sgtWeekday,
} from "./sgt";

// Every expected value is written with its offset, or read off Intl in
// Asia/Singapore, so these pass whatever zone the process runs in. Run the
// suite under TZ=UTC and TZ=America/Los_Angeles as well to be sure.

const H = 3_600_000;
// Fri 30 Oct 2026, 23:30 in Singapore; still Friday 15:30 in UTC.
const lateFriday = Date.parse("2026-10-30T23:30:00+08:00");
// Sat 31 Oct 2026, 00:30 in Singapore; Friday 16:30 in UTC, Friday morning in Los Angeles.
const earlySaturday = Date.parse("2026-10-31T00:30:00+08:00");

describe("reading a moment in Singapore", () => {
  it("files a moment under its Singapore day, not the process's", () => {
    expect(sgtDate(lateFriday)).toBe("2026-10-30");
    expect(sgtDate(earlySaturday)).toBe("2026-10-31");
    expect(sgtWeekday(lateFriday)).toBe(5);
    expect(sgtWeekday(earlySaturday)).toBe(6);
    expect(sgtHour(earlySaturday)).toBe(0);
    expect(sgtHHMM(lateFriday)).toBe("23:30");
    expect(sgtDayLabel(earlySaturday)).toBe("Sat 31 Oct");
    expect(sgtStamp(earlySaturday)).toBe("2026-10-31 00:30 (Sat)");
    expect(sgtMonth(Date.parse("2026-10-31T16:30:00Z"))).toBe("2026-11");
    expect(sgtClock(lateFriday).getUTCDate()).toBe(30);
  });

  it("agrees with Intl's Asia/Singapore across a year, hour by hour every 7h", () => {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: SGT_ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short" });
    const start = Date.parse("2026-01-01T00:00:00Z");
    for (let t = start; t < start + 366 * 24 * H; t += 7 * H + 60_000) {
      const p = Object.fromEntries(parts.formatToParts(t).map((x) => [x.type, x.value]));
      expect(sgtDate(t)).toBe(`${p.year}-${p.month}-${p.day}`);
      expect(sgtHHMM(t)).toBe(`${p.hour}:${p.minute}`);
      expect(sgtDayLabel(t).slice(0, 3)).toBe(p.weekday);
    }
  });

  it("finds the midnight that starts the day, and one number per day", () => {
    expect(sgtMidnight(lateFriday)).toBe(Date.parse("2026-10-30T00:00:00+08:00"));
    expect(sgtMidnight(earlySaturday)).toBe(Date.parse("2026-10-31T00:00:00+08:00"));
    expect(sgtMidnight(sgtMidnight(lateFriday))).toBe(sgtMidnight(lateFriday));
    expect(sgtDayNumber(earlySaturday) - sgtDayNumber(lateFriday)).toBe(1);
    expect(sgtDayNumber(lateFriday)).toBe(sgtDayNumber(Date.parse("2026-10-30T00:00:00+08:00")));
  });
});

describe("a Singapore day and time as a moment", () => {
  it("reads the time on that day in Singapore", () => {
    expect(sgtTime("2026-10-30", "14:00")).toBe(Date.parse("2026-10-30T06:00:00Z"));
    expect(sgtTime("2026-10-30")).toBe(Date.parse("2026-10-29T16:00:00Z"));
    expect(sgtNoon("2026-10-30")).toBe(Date.parse("2026-10-30T04:00:00Z"));
    expect(endOfSgtDay("2026-10-30")).toBe(Date.parse("2026-10-30T15:59:00Z"));
    expect(sgtAt("2026-10-30", "09:15")).toBe(Date.parse("2026-10-30T01:15:00Z"));
    expect(sgtAt("2026-10-30", null)).toBe(endOfSgtDay("2026-10-30"));
    expect(sgtTime("not a day")).toBeNaN();
  });

  it("adds whole days across months and years", () => {
    expect(addSgtDays("2026-10-30", 2)).toBe("2026-11-01");
    expect(addSgtDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(addSgtDays("2028-02-28", 1)).toBe("2028-02-29");
  });

  it("reads a model's dates as Singapore time unless they carry their own offset", () => {
    expect(parseSgt("2026-10-30")).toBe(endOfSgtDay("2026-10-30"));
    expect(parseSgt(" 2026-10-30T14:00 ")).toBe(sgtTime("2026-10-30", "14:00"));
    expect(parseSgt("2026-10-30 14:00:30")).toBe(sgtTime("2026-10-30", "14:00") + 30_000);
    expect(parseSgt("2026-10-30T14:00:00Z")).toBe(Date.parse("2026-10-30T14:00:00Z"));
    expect(parseSgt("soon")).toBeNaN();
  });
});
