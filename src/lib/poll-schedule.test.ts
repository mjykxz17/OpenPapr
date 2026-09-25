import { describe, expect, it } from "vitest";
import { isQuietHour, pollIntervalAt, staleAfterMs } from "./poll-schedule";

const sgt = (hhmm: string) => Date.parse(`2026-09-25T${hhmm}:00+08:00`);
const BASE = 300_000;

describe("poll schedule", () => {
  it("syncs every base interval by day and hourly between 1am and 7am SGT", () => {
    expect(pollIntervalAt(sgt("14:00"), BASE)).toBe(BASE);
    expect(pollIntervalAt(sgt("00:59"), BASE)).toBe(BASE);
    expect(pollIntervalAt(sgt("01:00"), BASE)).toBe(3_600_000);
    expect(pollIntervalAt(sgt("06:59"), BASE)).toBe(3_600_000);
    expect(pollIntervalAt(sgt("07:00"), BASE)).toBe(BASE);
    expect(isQuietHour(sgt("03:30"))).toBe(true);
  });
  it("does not call data stale overnight or just after the night ends", () => {
    expect(staleAfterMs(sgt("14:00"), BASE)).toBe(3 * BASE);
    expect(staleAfterMs(sgt("03:00"), BASE)).toBe(3 * 3_600_000);
    expect(staleAfterMs(sgt("07:30"), BASE)).toBe(3 * 3_600_000);
    expect(staleAfterMs(sgt("08:01"), BASE)).toBe(3 * BASE);
  });
  it("never speeds up a slower configured base", () => {
    expect(pollIntervalAt(sgt("03:00"), 2 * 3_600_000)).toBe(2 * 3_600_000);
  });
});
