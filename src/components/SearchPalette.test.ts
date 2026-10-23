import { describe, expect, it } from "vitest";
import { fewerWords } from "./SearchPalette";

describe("fewerWords", () => {
  it("offers the query's real words on their own, longest first", () => {
    expect(fewerWords("master theorem proof")).toEqual(["theorem", "master", "proof"]);
    expect(fewerWords("What's on quiz 3?")).toEqual(["quiz"]);
    expect(fewerWords("When is the heaps tutorial due")).toEqual(["tutorial", "heaps"]);
    expect(fewerWords("what’s about")).toEqual([]);
  });
  it("offers nothing for a one-word query", () => {
    expect(fewerWords("amortized")).toEqual([]);
    expect(fewerWords("  heaps  ")).toEqual([]);
  });
});
