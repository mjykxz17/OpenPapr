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
  // As pdf-parse writes it: each page's text, then its marker.
  const deck = [
    "a".repeat(520), "-- 1 of 4 --",
    "Fig 1", "-- 2 of 4 --",
    "b".repeat(870), "-- 3 of 4 --",
    "", "-- 4 of 4 --",
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

import { cleanCitations, deckShort, outlineText, parseSlideRange, sectionText } from "./study-guide";

// A deck as pdf-parse writes it, each page saying which page it is.
const pagesDeck = (n: number, chars = 40) =>
  Array.from({ length: n }, (_, i) => `page${i + 1} ${"x".repeat(chars)}\n-- ${i + 1} of ${n} --`).join("\n");

describe("parseSlideRange", () => {
  it("reads the ways an outline writes a range", () => {
    expect(parseSlideRange("4-6", 30)).toEqual([4, 5, 6]);
    expect(parseSlideRange("slides 4 to 6, 9", 30)).toEqual([4, 5, 6, 9]);
    expect(parseSlideRange("9–11", 30)).toEqual([9, 10, 11]);
  });

  it("stays inside the deck and gives nothing for no numbers", () => {
    expect(parseSlideRange("28-35", 30)).toEqual([28, 29, 30]);
    expect(parseSlideRange("the whole deck", 30)).toEqual([]);
  });

  it("does not take the deck's number for a slide", () => {
    expect(parseSlideRange("L1 slides 40-42", 50)).toEqual([40, 41, 42]);
    expect(parseSlideRange("S4-S6, p9", 50)).toEqual([4, 5, 6, 9]);
  });
});

describe("sectionText", () => {
  it("sends a section its own slides and two either side, not the whole deck", () => {
    const { text, pages } = sectionText(pagesDeck(300), "100-104", 300);
    expect(pages).toEqual([98, 99, 100, 101, 102, 103, 104, 105, 106]);
    expect(text).toContain("[Slide 100]\npage100");
    expect(text).not.toContain("page50 ");
  });

  it("falls back to the whole deck, clipped, when the range is unusable", () => {
    const { text, pages } = sectionText(pagesDeck(300, 400), "intro", 300, 30_000);
    expect(pages).toHaveLength(300);
    expect(text.length).toBeLessThan(40_000);
  });
});

describe("outlineText", () => {
  it("keeps a short deck whole", () => {
    expect(outlineText(pagesDeck(5))).toContain("x".repeat(40));
  });

  it("shows every slide of a huge deck, each cut short", () => {
    const text = outlineText(pagesDeck(400, 2000), 30_000);
    expect(text.length).toBeLessThan(40_000);
    expect(text).toContain("[Slide 1]\npage1");
    expect(text).toContain("[Slide 400]\npage400");
  });
});

describe("deckShort", () => {
  it("names a deck the way the course does", () => {
    expect(deckShort("L1-asymptotics")).toBe("L1");
    expect(deckShort("U3-memerr1")).toBe("U3");
    expect(deckShort("IFS4103-Lect-1-v1")).toBe("Lect 1");
    expect(deckShort("Lecture%205")).toBe("Lecture 5");
    expect(deckShort("intro")).toBe("intro");
  });

  it("keeps what tells a week's or a lecture's decks apart", () => {
    expect(deckShort("Week1-L1")).toBe("Week1 L1");
    expect(deckShort("Week1-L2")).toBe("Week1 L2");
    expect(deckShort("Lecture 1 Part A")).toBe("Lecture 1 Part A");
    expect(deckShort("Lecture 1 Part B")).toBe("Lecture 1 Part B");
  });
});

describe("cleanCitations", () => {
  const decks = new Map([["L1-asymptotics", 30]]);

  it("writes each link's text from where it points", () => {
    const { markdown } = cleanCitations("Big-O [slide 81](slide:L1-asymptotics#18).", decks);
    expect(markdown).toBe("Big-O [L1 p18](slide:L1-asymptotics#18).");
  });

  it("repairs a near-miss deck name and leaves image captions alone", () => {
    const r = cleanCitations("See [s](slide:L1 asymptotics.pdf#3).\n\n![The tree](slide-img:l1-Asymptotics#4)", decks);
    expect(r.markdown).toBe("See [L1 p3](slide:L1-asymptotics#3).\n\n![The tree](slide-img:L1-asymptotics#4)");
    expect(r.repaired).toBe(2);
  });

  it("takes out citations to a missing deck or a slide past the end", () => {
    const r = cleanCitations("A claim [slide 99](slide:L1-asymptotics#99). Another (see [slide 2](slide:Other-deck#2)).\n\n![fig](slide-img:L1-asymptotics#0)\n\nEnd.", decks);
    expect(r.markdown).toBe("A claim. Another.\n\nEnd.");
    expect(r.removed).toBe(3);
  });

  it("names decks in full when two would share a short name", () => {
    const two = new Map([["L1-intro", 10], ["L1-part2", 10]]);
    expect(cleanCitations("[x](slide:L1-intro#2)", two).markdown).toBe("[L1-intro p2](slide:L1-intro#2)");
    // A deck in another chapter counts too.
    expect(cleanCitations("[x](slide:L1-intro#2)", new Map([["L1-intro", 10]]), ["L1-recap"]).markdown).toBe("[L1-intro p2](slide:L1-intro#2)");
  });

  it("tidies only where a link was taken out", () => {
    const clean = (md: string) => cleanCitations(md, decks).markdown;
    expect(clean("Call `f()` then (see [slide 99](slide:L1-asymptotics#99)).")).toBe("Call `f()` then.");
    expect(clean("Use x : y and `a ; b` [s](slide:L1-asymptotics#99) here.")).toBe("Use x : y and `a ; b` here.");
    expect(clean("Both [a](slide:L1-asymptotics#2), [b](slide:L1-asymptotics#99), [c](slide:L1-asymptotics#3) say so.")).toBe("Both [L1 p2](slide:L1-asymptotics#2), [L1 p3](slide:L1-asymptotics#3) say so.");
    expect(clean("(see [b](slide:L1-asymptotics#99), [c](slide:L1-asymptotics#3))")).toBe("(see [L1 p3](slide:L1-asymptotics#3))");
    expect(clean("Line one  \nends [x](slide:L1-asymptotics#99)")).toBe("Line one  \nends");
  });

  it("drops a bullet that held only a bad citation", () => {
    expect(cleanCitations("- first\n- [slide 99](slide:L1-asymptotics#99)\n- third", decks).markdown).toBe("- first\n- third");
  });

  it("leaves a citation inside inline code as it is", () => {
    const md = "Write `[slide 99](slide:L1-asymptotics#99)` to cite.";
    expect(cleanCitations(md, decks).markdown).toBe(md);
  });

  it("leaves code alone", () => {
    const md = "```\n[slide 99](slide:L1-asymptotics#99)\n```";
    expect(cleanCitations(md, decks).markdown).toBe(md);
  });
});
