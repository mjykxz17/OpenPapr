import { describe, expect, it } from "vitest";
import { dueLabel, relativeDay, shortDate, syncedLabel } from "./format-date";

// Tuesday 22 September 2026, 14:00 local time.
const now = new Date(2026, 8, 22, 14, 0).getTime();
const at = (d: number, h = 10, m = 0) => new Date(2026, 8, d, h, m).getTime();

describe("format-date", () => {
  it("shortDate is day + short month", () => {
    expect(shortDate(at(14))).toMatch(/^14 Sep/);
  });
  it("relativeDay names today, yesterday, the weekday inside a week, else the date", () => {
    expect(relativeDay(at(22, 9), now)).toBe("Today");
    expect(relativeDay(at(21, 23), now)).toBe("Yesterday");
    expect(relativeDay(at(19), now)).toBe("Sat");
    expect(relativeDay(at(12), now)).toMatch(/^12 Sep/);
  });
  it("dueLabel is relative inside the week and never shows seconds", () => {
    expect(dueLabel(at(22, 23, 59), now)).toBe("Today, 23:59");
    expect(dueLabel(at(23, 18, 0), now)).toBe("Tomorrow, 18:00");
    expect(dueLabel(at(25, 23, 59), now)).toMatch(/^Fri 25 Sep\w*, 23:59$/);
    expect(dueLabel(at(30, 9, 0), now)).toMatch(/^30 Sep\w*, 09:00$/);
  });
  it("syncedLabel is a time today and a day otherwise", () => {
    expect(syncedLabel(at(22, 14, 2), now)).toBe("14:02");
    expect(syncedLabel(at(20, 9, 12), now)).toBe("Sun");
  });
});
