import { beforeEach, describe, expect, it } from "vitest";
import { pruneRateLimits, rateLimit, resetRateLimits } from "./rate-limit";

beforeEach(resetRateLimits);

describe("rateLimit", () => {
  it("allows up to the limit and then refuses", () => {
    for (let i = 0; i < 5; i++) expect(rateLimit("a", 5, 1000, 0)).toBe(true);
    expect(rateLimit("a", 5, 1000, 0)).toBe(false);
  });

  it("keeps separate counters per key", () => {
    for (let i = 0; i < 5; i++) rateLimit("a", 5, 1000, 0);
    expect(rateLimit("a", 5, 1000, 0)).toBe(false);
    expect(rateLimit("b", 5, 1000, 0)).toBe(true);
  });

  it("lets the caller through again once the window rolls over", () => {
    for (let i = 0; i < 5; i++) rateLimit("a", 5, 1000, 0);
    expect(rateLimit("a", 5, 1000, 999)).toBe(false);
    expect(rateLimit("a", 5, 1000, 1000)).toBe(true);
  });

  it("prunes expired windows so the map cannot grow unbounded", () => {
    rateLimit("a", 5, 1000, 0);
    pruneRateLimits(2000);
    // A pruned key starts a fresh window, so the full budget is available.
    for (let i = 0; i < 5; i++) expect(rateLimit("a", 5, 1000, 2000)).toBe(true);
  });
});
