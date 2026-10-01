import { describe, expect, it } from "vitest";
import { buildIcs } from "./ics";

describe("buildIcs", () => {
  it("writes timed and all-day events, escaped and folded", () => {
    const ics = buildIcs("OpenPapr", [
      { uid: "item-1@openpapr", title: "CS4239: Assignment 1, part A; due", start: Date.UTC(2026, 9, 18, 15, 29), end: Date.UTC(2026, 9, 18, 15, 59) },
      { uid: "task-2@openpapr", title: "Quiz 3 (expected)", date: "2026-10-04", allDay: true, description: "line one\nline two " + "x".repeat(100) },
    ], Date.UTC(2026, 9, 1));
    expect(ics).toContain("DTSTART:20261018T152900Z");
    expect(ics).toContain("DTSTART;VALUE=DATE:20261004");
    expect(ics).toContain("DTEND;VALUE=DATE:20261005");
    expect(ics).toContain("SUMMARY:CS4239: Assignment 1\\, part A\; due");
    expect(ics).toContain("\\nline two");
    expect(ics.split("\r\n").every((l) => new TextEncoder().encode(l).length <= 75)).toBe(true);
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
  });
});
