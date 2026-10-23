import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PDFParse } from "pdf-parse";
import { DEMO_DECK_SOURCES, deckPages } from "./decks";
import { deckPdf } from "./pdf";
import { DEMO_CITATIONS, DEMO_GUIDES } from "./guides";
import { cleanQuiz } from "../server/guide-quiz";
import { renderPdfPage } from "../lib/pdf-render";
import { splitGuideIntoChapters } from "../lib/study-chapters";
import { decodeDeck } from "../lib/slide-citation";

const dir = join(__dirname, "decks");
const flat = (s: string) => s.replace(/\s+/g, " ").trim();

// Each page's text as pdf.js reads it out of the committed PDF.
async function pagesOf(stem: string): Promise<string[]> {
  const p = new PDFParse({ data: new Uint8Array(readFileSync(join(dir, `${stem}.pdf`))) });
  try { return (await p.getText()).pages.map((x) => flat(x.text)); } finally { await p.destroy(); }
}

describe("demo decks", () => {
  it("are exactly what make-demo-decks writes from decks.ts, and nothing else", () => {
    for (const d of DEMO_DECK_SOURCES) {
      expect(Buffer.from(readFileSync(join(dir, `${d.stem}.pdf`))).equals(Buffer.from(deckPdf(d))), `${d.stem}.pdf is stale: run npx tsx scripts/make-demo-decks.ts`).toBe(true);
    }
    expect(readdirSync(dir).filter((f) => f.endsWith(".pdf")).sort()).toEqual(DEMO_DECK_SOURCES.map((d) => `${d.stem}.pdf`).sort());
  });

  it("read back page by page with the text they were written from", async () => {
    for (const d of DEMO_DECK_SOURCES) {
      const pages = await pagesOf(d.stem);
      expect(pages).toHaveLength(deckPages(d));
      pages.forEach((text, i) => {
        const slide = i === 0 ? { title: d.title, bullets: [d.subtitle] } : d.slides[i - 1]!;
        for (const line of [slide.title, ...slide.bullets]) expect(text, `${d.stem} p${i + 1}`).toContain(flat(line));
        expect(text).toContain(`${d.footer} · ${i + 1}/${deckPages(d)}`);
      });
    }
  });

  it("render in the server's slide renderer", async () => {
    const png = await renderPdfPage(new Uint8Array(readFileSync(join(dir, "L4-reliable-transfer.pdf"))), 7, 1);
    expect(png).not.toBeNull();
    expect(Buffer.from(png!.slice(0, 8)).toString("hex")).toBe("89504e470d0a1a0a");
    expect(png!.length).toBeGreaterThan(10_000);
  });
});

describe("demo study guides", () => {
  it("cite only slides that say what the guide claims", async () => {
    expect(DEMO_CITATIONS.length).toBeGreaterThan(30);
    const cache = new Map<string, string[]>();
    for (const c of DEMO_CITATIONS) {
      const deck = DEMO_DECK_SOURCES.find((d) => d.stem === c.deck);
      expect(deck?.module, `${c.deck} p${c.page}`).toBe(c.module);
      if (!cache.has(c.deck)) cache.set(c.deck, await pagesOf(c.deck));
      expect(cache.get(c.deck)![c.page - 1], `${c.deck} p${c.page} should say "${c.says}"`).toContain(flat(c.says));
    }
  });

  it("label every citation with the page it opens, in a deck of the guide's own module", () => {
    for (const g of DEMO_GUIDES) {
      const links = [...g.markdown.matchAll(/\[([^\]]+)\]\((slide|slide-img):([^)#]+)#(\d+)\)/g)];
      expect(links.length).toBeGreaterThan(5);
      for (const [, label, scheme, rawDeck, page] of links) {
        const deck = DEMO_DECK_SOURCES.find((d) => d.stem === decodeDeck(rawDeck!));
        expect(deck?.module, `${g.module}: ${rawDeck}`).toBe(g.module);
        expect(Number(page)).toBeLessThanOrEqual(deckPages(deck!));
        if (scheme === "slide") expect(label).toMatch(new RegExp(` p${page}$`));
      }
    }
  });

  it("have practice questions for every chapter, each from a slide the chapter cites", () => {
    for (const g of DEMO_GUIDES) {
      const chapters = splitGuideIntoChapters(g.markdown).chapters;
      expect(chapters.length).toBeGreaterThanOrEqual(2);
      expect(g.quizzes).toHaveLength(chapters.length);
      chapters.forEach((c, i) => {
        const qs = g.quizzes[i]!;
        expect(qs.length).toBeGreaterThanOrEqual(4);
        // The same check a model's questions go through.
        const raw = { questions: qs.map((x) => ({ ...x, slide: `slide:${encodeURIComponent(x.slide!.deck)}#${x.slide!.page}` })) };
        expect(cleanQuiz(raw, c.markdown), `${g.module} ${c.label}`).toEqual(qs);
        // Not always the first option.
        expect(new Set(qs.map((x) => x.answer)).size).toBeGreaterThan(1);
      });
    }
  });
});
