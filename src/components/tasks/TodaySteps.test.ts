import { describe, expect, it } from "vitest";
import type { TodayStep } from "@/server/tasks";
import { HOLD_MS, mergeHeld, queueBy } from "./TodaySteps";

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

describe("a step's requests go in order", () => {
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  it("sends an Undo only after the tick it undoes has landed", async () => {
    const queue = queueBy();
    const log: string[] = [];
    // The tick is slow; the Undo would otherwise land first.
    const tick = queue("1:s1", async () => { await wait(20); log.push("done"); return true; });
    const undo = queue("1:s1", async () => { log.push("open"); return true; });
    expect(await Promise.all([tick, undo])).toEqual([true, true]);
    expect(log).toEqual(["done", "open"]);
  });
  it("keeps going after a request fails, and does not hold up other steps", async () => {
    const queue = queueBy();
    const log: string[] = [];
    const bad = queue("1:s1", async () => { await wait(20); throw new Error("offline"); });
    const next = queue("1:s1", async () => { log.push("1:s1"); return true; });
    const other = queue("2:s1", async () => { log.push("2:s1"); return true; });
    await expect(bad).rejects.toThrow("offline");
    expect(await next).toBe(true);
    await other;
    expect(log).toEqual(["2:s1", "1:s1"]);
  });
});
