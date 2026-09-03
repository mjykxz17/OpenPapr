import { describe, expect, it } from "vitest";
import { figureSlides, normalizeFences, preferColourDeck, slidePages, validateChapter } from "./study-guide";

describe("preferColourDeck", () => {
  it("keeps the colour deck and drops its printable twin", () => {
    expect(preferColourDeck(["IFS4103-Lect-1-v1-3.pdf", "IFS4103-Lect-1-v1-BW-3.pdf"]))
      .toEqual(["IFS4103-Lect-1-v1-3.pdf"]);
  });

  it("keeps decks that are genuinely different lectures", () => {
    const names = ["Lect-1.pdf", "Lect-2.pdf"];
    expect(preferColourDeck(names).sort()).toEqual(names);
  });

  it("keeps a BW deck when it is the only copy", () => {
    expect(preferColourDeck(["Lect-3-BW.pdf"])).toEqual(["Lect-3-BW.pdf"]);
  });

  it("handles a whole mixed set", () => {
    const out = preferColourDeck([
      "IFS4103-Lect-1-v1-3.pdf", "IFS4103-Lect-1-v1-BW-3.pdf",
      "IFS4103-Lect-2-v1-2.pdf", "IFS4103-Lect-2-v1-BW-2.pdf",
      "intro.pdf",
    ]).sort();
    expect(out).toEqual(["IFS4103-Lect-1-v1-3.pdf", "IFS4103-Lect-2-v1-2.pdf", "intro.pdf"]);
  });
});

describe("validateChapter", () => {
  const ok = `### A section

Text with a citation [slide 4](slide:Deck#4).

\`\`\`mermaid
graph TD
  A --> B
\`\`\`

More text.
`;

  it("passes a well-formed chapter", () => {
    expect(validateChapter(ok, "Deck", 48)).toEqual([]);
  });

  it("does not flag a fence that ends the document", () => {
    const md = "### S\n\n[slide 1](slide:Deck#1)\n\n```mermaid\ngraph TD\n  A --> B\n```";
    expect(validateChapter(md, "Deck", 48)).toEqual([]);
  });

  it("catches a closing fence pressed against the next paragraph", () => {
    const md = "### S\n\n[slide 1](slide:Deck#1)\n\n```mermaid\ngraph TD\n```\nSwallowed text.\n";
    expect(validateChapter(md, "Deck", 48).join(" ")).toMatch(/not followed by a blank line/);
  });

  it("catches an unbalanced fence", () => {
    const bad = "### S\n\n```mermaid\ngraph TD\n  A --> B\n";
    expect(validateChapter(bad, "Deck", 48).join(" ")).toMatch(/unbalanced/);
  });

  it("catches a citation past the end of the deck", () => {
    const bad = "### S\n\nSee [slide 99](slide:Deck#99).\n";
    expect(validateChapter(bad, "Deck", 48).join(" ")).toMatch(/outside 1\.\.48/);
  });

  it("catches a chapter with no citations at all", () => {
    expect(validateChapter("### S\n\nJust prose.\n", "Deck", 48).join(" ")).toMatch(/no slide citations/);
  });

  it("catches citations pointing at another deck", () => {
    const bad = "### S\n\n[slide 4](slide:OtherDeck#4)\n";
    expect(validateChapter(bad, "Deck", 48).join(" ")).toMatch(/unknown deck/);
  });

  it("accepts embedded slide images as citations", () => {
    const md = "### S\n\n![figure](slide-img:Deck#12)\n";
    expect(validateChapter(md, "Deck", 48)).toEqual([]);
  });
});

describe("normalizeFences", () => {
  it("inserts a blank line before an opening fence", () => {
    const out = normalizeFences("Some prose.\n```mermaid\ngraph TD\n```\n");
    expect(out).toContain("Some prose.\n\n```mermaid");
  });

  it("inserts a blank line after a closing fence", () => {
    const out = normalizeFences("```mermaid\ngraph TD\n```\nNext paragraph.");
    expect(out).toContain("```\n\nNext paragraph.");
  });

  it("leaves already-correct markdown alone", () => {
    const good = "Prose.\n\n```mermaid\ngraph TD\n```\n\nMore.";
    expect(normalizeFences(good)).toBe(good);
  });

  it("does not touch content inside a fence", () => {
    const md = "```\nline one\n\nline two\n```\n";
    expect(normalizeFences(md)).toContain("line one\n\nline two");
  });
});

describe("slidePages / figureSlides", () => {
  // Lengths mirror the real distribution measured on IFS4103-Lect-1: text
  // slides run 288-1370 characters, figure slides 34-42, with a clean gap
  // between. The default 180 threshold sits in that gap.
  const deck = [
    "-- 1 of 4 --", "a".repeat(520),
    "-- 2 of 4 --", "Fig 1",
    "-- 3 of 4 --", "b".repeat(870),
    "-- 4 of 4 --", "",
  ].join("\n");

  it("splits the deck on its page markers", () => {
    expect(slidePages(deck).map((p) => p.page)).toEqual([1, 2, 3, 4]);
  });

  it("treats a page with little text as carrying a figure", () => {
    expect(figureSlides(deck)).toEqual([2]);
  });

  it("ignores pages with no text at all — nothing to show", () => {
    expect(figureSlides(deck)).not.toContain(4);
  });

  it("returns nothing for a deck that is all prose", () => {
    const wordy = ["-- 1 of 1 --", "x".repeat(500)].join("\n");
    expect(figureSlides(wordy)).toEqual([]);
  });
});

import { selectGuideDecks } from "./study-guide";

describe("selectGuideDecks", () => {
  const row = (displayName: string, category: string | null = null) => ({ displayName, category });

  it("takes the PDFs categorised as slides, in natural order, colour over black-and-white", () => {
    const picked = selectGuideDecks([
      row("IFS4103-Lect-10-v1.pdf", "slides"),
      row("IFS4103-Lect-2-v1-BW.pdf", "slides"),
      row("IFS4103-Lect-2-v1.pdf", "slides"),
      row("assignment1.pdf", "assignment"),
      row("intro.pdf", "slides"),
      row("CS4238-Lec01A.pptx", "slides"),
    ]);
    expect(picked.map((r) => r.displayName)).toEqual(["IFS4103-Lect-2-v1.pdf", "IFS4103-Lect-10-v1.pdf", "intro.pdf"]);
  });

  it("leaves out slides-looking names that were categorised as something else", () => {
    const picked = selectGuideDecks([row("Feedback for Lecture Topic 5.pdf", "admin"), row("U1-intro1.pdf", "slides")]);
    expect(picked.map((r) => r.displayName)).toEqual(["U1-intro1.pdf"]);
  });

  it("falls back to the filename pattern only while nothing in the module is categorised yet", () => {
    const picked = selectGuideDecks([row("U1-intro1.pdf"), row("assignment1.pdf"), row("Week 3 notes.pdf")]);
    expect(picked.map((r) => r.displayName)).toEqual(["U1-intro1.pdf", "Week 3 notes.pdf"]);
  });

  it("does not fall back once any file has a category, even if no slides were found", () => {
    expect(selectGuideDecks([row("U1-intro1.pdf", "reading")])).toEqual([]);
  });
});
