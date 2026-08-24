import { describe, expect, it } from "vitest";
import { splitGuideIntoChapters, chapterLabel, slugifyHeading, extractSubheadings } from "./study-chapters";

const md = `# CS4239 Guide

*Prepared from the decks.*

## 1. The big picture: what this course is really about

Software security is...

## 2. Course logistics (U0-prelim)

The course is 100% CA.

## 6. Key terms glossary

- **Exploit** — ...
`;

describe("splitGuideIntoChapters", () => {
  it("separates the preamble (title + intro) from the chapters", () => {
    const { preamble, chapters } = splitGuideIntoChapters(md);
    expect(preamble).toContain("# CS4239 Guide");
    expect(preamble).toContain("*Prepared from the decks.*");
    expect(preamble).not.toContain("## 1.");
    expect(chapters).toHaveLength(3);
  });
  it("keeps each chapter's own ## heading and body together", () => {
    const { chapters } = splitGuideIntoChapters(md);
    expect(chapters[0].markdown).toContain("## 1. The big picture");
    expect(chapters[0].markdown).toContain("Software security is...");
    expect(chapters[0].markdown).not.toContain("## 2.");
    expect(chapters[1].markdown).toContain("The course is 100% CA.");
  });
  it("handles a guide with no chapters (all preamble)", () => {
    const { preamble, chapters } = splitGuideIntoChapters("# Just a title\n\nsome text");
    expect(chapters).toHaveLength(0);
    expect(preamble).toContain("Just a title");
  });
});

describe("chapterLabel", () => {
  it("keeps the number, drops the colon tail", () => {
    expect(chapterLabel("## 1. The big picture: what this course is really about")).toBe("1. The big picture");
  });
  it("drops a trailing parenthetical", () => {
    expect(chapterLabel("## 4. The C programming refresher (C-part1, C-part2)")).toBe("4. The C programming refresher");
  });
  it("leaves a plain heading intact", () => {
    expect(chapterLabel("## 6. Key terms glossary")).toBe("6. Key terms glossary");
  });
});


describe("slugifyHeading", () => {
  it("lowercases and hyphenates", () => {
    expect(slugifyHeading("3.1 The Process Memory Layout")).toBe("3-1-the-process-memory-layout");
  });
});

describe("extractSubheadings", () => {
  const md = "## 3. C\n\n### 3.1 Compile pipeline\n\ntext\n\n```c\n// ### not a heading\n```\n\n### 3.2 Pointers\n\nmore";
  it("lists ### headings with slugs, skipping code fences", () => {
    expect(extractSubheadings(md)).toEqual([
      { label: "3.1 Compile pipeline", slug: "3-1-compile-pipeline" },
      { label: "3.2 Pointers", slug: "3-2-pointers" },
    ]);
  });
  it("returns [] when there are no subheadings", () => {
    expect(extractSubheadings("## 1. Intro\n\njust text")).toEqual([]);
  });
});
