import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PDFParse } from "pdf-parse";
import { pdfjsDataOptions, renderPdfPage } from "./pdf-render";

// L1-asymptotics.pdf uses Helvetica without embedding it, like most lecture
// decks. Without the standard font data pdf.js says so and draws the text in
// whatever the canvas calls sans-serif, which on the Alpine image is a serif.
const deck = () => new Uint8Array(readFileSync(join(process.cwd(), "src", "demo", "decks", "L1-asymptotics.pdf")));
const FALLBACK = /standardFontDataUrl/;

async function warningsWhileDrawing(options: Record<string, unknown>): Promise<string[]> {
  const seen: string[] = [];
  const spies = (["log", "warn"] as const).map((k) =>
    vi.spyOn(console, k).mockImplementation((...a: unknown[]) => { seen.push(a.map(String).join(" ")); }));
  try {
    // Verbosity 1 is pdf.js's "warnings"; pdf-parse turns them off by default.
    const parser = new PDFParse({ data: deck(), verbosity: 1, ...options });
    await parser.getScreenshot({ partial: [2], scale: 0.5 });
    await parser.destroy();
  } finally {
    for (const s of spies) s.mockRestore();
  }
  return seen;
}

describe("standard fonts on the server", () => {
  it("falls back without the font data, and not with it", async () => {
    expect((await warningsWhileDrawing({})).some((w) => FALLBACK.test(w))).toBe(true);
    expect((await warningsWhileDrawing(pdfjsDataOptions())).filter((w) => FALLBACK.test(w))).toEqual([]);
  });

  it("renderPdfPage hands pdf.js the font data", async () => {
    const seen: Record<string, unknown>[] = [];
    const real = PDFParse.prototype.getScreenshot;
    const spy = vi.spyOn(PDFParse.prototype, "getScreenshot").mockImplementation(function (this: PDFParse, ...args) {
      // pdf-parse keeps the constructor's options on the instance.
      seen.push((this as unknown as { options: Record<string, unknown> }).options);
      return real.apply(this, args);
    });
    try {
      expect(await renderPdfPage(deck(), 2, 0.5)).not.toBeNull();
    } finally { spy.mockRestore(); }
    expect(seen[0]).toMatchObject({ standardFontDataUrl: pdfjsDataOptions().standardFontDataUrl });
  });
});
