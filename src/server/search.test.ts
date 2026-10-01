import { describe, expect, it } from "vitest";
import { guideSections, plainMarkdown, snippet, terms } from "./search";

describe("search helpers", () => {
  it("splits a guide into sections", () => {
    const md = "# T\n\nintro\n\n## 1. Buffer overflows\n\nStack **smashing** [L3 p4](slide:L3#4)\n\n### Canaries\n\nA canary sits before the return address.\n\n```mermaid\n### not a heading\n```\n\n## 2. Heap\n\nmalloc";
    const s = guideSections(md);
    expect(s.map((x) => x.heading)).toEqual(["1. Buffer overflows", "Canaries", "2. Heap"]);
    expect(s[0]!.slug).toBe("1-buffer-overflows");
    expect(s[0]!.text).toBe("Stack smashing");
    expect(s[1]!.text).toBe("A canary sits before the return address.");
  });
  it("cleans markdown and terms", () => {
    expect(plainMarkdown("See ![fig](slide-img:L1#2) and [docs](https://x.y) **now**")).toBe("See and docs now");
    expect(terms("What's the CS4238 quiz?")).toEqual(["what", "the", "cs4238", "quiz"]);
  });
  it("cuts a snippet around the match", () => {
    const text = `${"lorem ipsum ".repeat(30)}the stack canary detects overwrites ${"dolor sit ".repeat(30)}`;
    const s = snippet(text, ["canary"]);
    expect(s).toContain("canary");
    expect(s.startsWith("…")).toBe(true);
    expect(s.length).toBeLessThanOrEqual(163);
  });
});
