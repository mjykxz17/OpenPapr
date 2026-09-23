import { describe, expect, it } from "vitest";
import { showOutcome } from "./GenerateGuideButton";

const NOW = 1_800_000_000_000;
const failed = (error: string, ageMs: number) => ({ state: "failed" as const, error, finishedAt: NOW - ageMs });

describe("showOutcome", () => {
  it("hides an old failure left over from an earlier setup", () => {
    expect(showOutcome(failed("no LLM provider configured", 3 * 86_400_000), NOW, false, true)).toBe(false);
  });
  it("hides a provider failure once a provider exists, even a fresh one", () => {
    expect(showOutcome(failed("no AI provider — add your own API key in Account", 60_000), NOW, false, true)).toBe(false);
  });
  it("keeps a provider failure while there is still no provider", () => {
    expect(showOutcome(failed("no AI provider — add your own API key in Account", 60_000), NOW, false, false)).toBe(true);
  });
  it("shows a recent real failure, and any failure of a run started here", () => {
    expect(showOutcome(failed("llm 401: bad key", 60_000), NOW, false, true)).toBe(true);
    expect(showOutcome(failed("llm 401: bad key", 86_400_000), NOW, true, true)).toBe(true);
  });
  it("shows nothing for a run without a message", () => {
    expect(showOutcome({ state: "done", error: null, finishedAt: NOW }, NOW, true, true)).toBe(false);
  });
});
