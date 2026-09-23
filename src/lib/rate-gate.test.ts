import { describe, expect, it } from "vitest";
import { RateGate } from "./rate-gate";

describe("RateGate", () => {
  it("lets at most rpm calls through per window, in order", async () => {
    const gate = new RateGate(2, 300);
    const start = Date.now();
    const at: number[] = [];
    await Promise.all(Array.from({ length: 5 }, (_, i) => gate.acquire().then(() => { at[i] = Date.now() - start; })));
    // First two at once, next two after one window, the fifth after two.
    expect(at[0]).toBeLessThan(100);
    expect(at[1]).toBeLessThan(100);
    expect(at[2]).toBeGreaterThanOrEqual(290);
    expect(at[3]).toBeGreaterThanOrEqual(290);
    expect(at[4]).toBeGreaterThanOrEqual(590);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });
  it("does not wait at all without a limit", async () => {
    const gate = new RateGate(null, 300);
    const t = Date.now();
    await Promise.all(Array.from({ length: 50 }, () => gate.acquire()));
    expect(Date.now() - t).toBeLessThan(100);
  });
});
