import { describe, expect, it } from "vitest";
import { assembleGuide, chapterDeck, mergeChapters, renumber, splitChapters } from "./guide-chapters";

const ch = (n: number, title: string, deck: string) =>
  `## ${n}. ${title}\n\n### ${n}.1 Intro\n\nText [slide 2](slide:${deck}#2) and [slide 3](slide:${deck}#3).\n\n### ${n}.2 More\n\n![fig](slide-img:${deck}#4)`;

const guide = ["# CS1 Guide\n\n*preamble*", ch(1, "Requirements", "L2 requirements"), ch(2, "OOP", "L4-oop"), ch(3, "Testing", "L6-testing")].join("\n\n");

describe("splitChapters", () => {
  it("splits on chapter headings and names each chapter's deck", () => {
    const { preamble, chapters } = splitChapters(guide);
    expect(preamble).toBe("# CS1 Guide\n\n*preamble*");
    expect(chapters.map((c) => c.deck)).toEqual(["L2 requirements", "L4-oop", "L6-testing"]);
  });
  it("ignores a chapter-like line inside a code fence", () => {
    const md = `# G\n\n## 1. A\n\n\`\`\`\n## 2. not a chapter\n\`\`\`\n\n[s](slide:A#1)`;
    expect(splitChapters(md).chapters).toHaveLength(1);
  });
  it("treats a guide without chapters as all preamble", () => {
    expect(splitChapters("# Just a title")).toEqual({ preamble: "# Just a title", chapters: [] });
  });
});

describe("chapterDeck", () => {
  it("picks the deck cited most", () => {
    expect(chapterDeck("[a](slide:X#1) [b](slide:Y#2) [c](slide:Y#3)")).toBe("Y");
    expect(chapterDeck("no citations")).toBeNull();
  });
});

describe("mergeChapters", () => {
  it("replaces the chapter for a rewritten deck and keeps the others in teaching order", () => {
    const { preamble, chapters } = splitChapters(guide);
    const fresh = splitChapters(ch(1, "OOP, rewritten", "L4-oop")).chapters;
    const merged = mergeChapters(chapters, fresh);
    expect(merged.map((c) => c.deck)).toEqual(["L2 requirements", "L4-oop", "L6-testing"]);
    expect(merged[1]!.markdown).toMatch(/^## 2\. OOP, rewritten/);
    expect(merged[1]!.markdown).toContain("### 2.1 Intro");
    const out = assembleGuide(preamble, merged);
    expect(out.startsWith("# CS1 Guide")).toBe(true);
    expect(out.match(/^## \d+\./gm)).toEqual(["## 1.", "## 2.", "## 3."]);
  });
  it("adds a new deck's chapter in its place in the order", () => {
    const { chapters } = splitChapters(guide);
    const merged = mergeChapters(chapters, splitChapters(ch(1, "Design", "L5-design")).chapters);
    expect(merged.map((c) => c.deck)).toEqual(["L2 requirements", "L4-oop", "L5-design", "L6-testing"]);
    expect(merged[3]!.markdown).toMatch(/^## 4\. Testing/);
    expect(merged[3]!.markdown).toContain("### 4.2 More");
  });
  it("orders L2 before L10", () => {
    const merged = mergeChapters(splitChapters(ch(1, "Ten", "L10")).chapters, splitChapters(ch(1, "Two", "L2")).chapters);
    expect(merged.map((c) => c.deck)).toEqual(["L2", "L10"]);
  });
});

describe("renumber", () => {
  it("leaves fenced code alone", () => {
    const [c] = renumber([{ deck: "A", markdown: "## 7. T\n\n```\n### 7.1 not a heading\n```\n\n### 7.2 Real" }, { deck: "B", markdown: "## 9. U" }].slice(0, 1));
    expect(c!.markdown).toBe("## 1. T\n\n```\n### 7.1 not a heading\n```\n\n### 1.2 Real");
  });
});

describe("deck names with spaces", () => {
  it("are cited %20-encoded and read back decoded", async () => {
    const { citeDeck, parseSlideCitation, citedPagesByDeck } = await import("./slide-citation");
    const { validateChapter } = await import("../enrich/study-guide");
    const cite = citeDeck("Lecture 5 (Threats)");
    const md = `## 1. T\n\n[slide 2](slide:${cite}#2) ![f](slide-img:${cite}#3)`;
    expect(parseSlideCitation(`slide:${cite}#2`)).toEqual({ deck: "Lecture 5 (Threats)", page: 2 });
    expect(citedPagesByDeck(md)).toEqual({ "Lecture 5 (Threats)": [2] });
    expect(chapterDeck(md)).toBe("Lecture 5 (Threats)");
    expect(validateChapter(md, cite, 10)).toEqual([]);
  });
});
