import { describe, expect, it } from "vitest";
import type { TodayStep } from "@/server/tasks";
import { HOLD_MS, mergeHeld } from "./TodaySteps";

const step = (taskId: number, id: string, minutes = 30): TodayStep =>
  ({ id, text: `${taskId}-${id}`, minutes, doBy: "2026-10-01", done: false, taskId, taskTitle: "T", code: null, dueAt: null, late: false });

describe("a ticked step stays put", () => {
  const a = step(1, "s1", 60), b = step(1, "s2"), c = step(2, "s1", 5);

  it("keeps a step the server no longer lists where it was", () => {
    // Ticked b (second of three); the refreshed list has only a and c.
    expect(mergeHeld([a, c], [{ step: { ...b, done: true }, at: 1, leaving: false }]).map((s) => s.text)).toEqual(["1-s1", "1-s2", "2-s1"]);
  });
  it("does not show it twice while the server still lists it", () => {
    expect(mergeHeld([a, b, c], [{ step: { ...b, done: true }, at: 1, leaving: false }])).toEqual([a, b, c]);
  });
  it("keeps several in their order, even when the list got shorter", () => {
    const held = [{ step: c, at: 2, leaving: false }, { step: a, at: 0, leaving: false }];
    expect(mergeHeld([b], held).map((s) => s.text)).toEqual(["1-s1", "1-s2", "2-s1"]);
    expect(mergeHeld([], [{ step: c, at: 5, leaving: false }])).toEqual([c]);
  });
  it("gives a few seconds to undo", () => {
    expect(HOLD_MS).toBeGreaterThanOrEqual(4000);
  });
});
