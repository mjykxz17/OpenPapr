import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pdfjsDataOptions, renderPdfPage } from "./pdf-render";

describe("pdfjsDataOptions", () => {
  // Without these pdf.js draws a deck's non-embedded Helvetica with whatever
  // the canvas calls sans-serif, which on the server's Alpine image is serif.
  it("points pdf.js at its own standard fonts, cmaps and decoders", () => {
    const o = pdfjsDataOptions();
    expect(o.standardFontDataUrl).toMatch(/standard_fonts\/$/);
    expect(existsSync(join(o.standardFontDataUrl!, "LiberationSans-Regular.ttf"))).toBe(true);
    expect(existsSync(o.cMapUrl!)).toBe(true);
    expect(existsSync(o.wasmUrl!)).toBe(true);
    // pdf.js refuses a directory without the trailing slash.
    for (const url of [o.standardFontDataUrl, o.cMapUrl, o.wasmUrl]) expect(url!.endsWith("/")).toBe(true);
  });

  it("leaves pdf.js to its defaults when the files are not there", () => {
    expect(pdfjsDataOptions("/nowhere/pdfjs-dist")).toEqual({});
  });
});

describe("renderPdfPage", () => {
  it("draws a slide of a deck whose fonts are not embedded", async () => {
    const deck = new Uint8Array(readFileSync(join(process.cwd(), "src", "demo", "decks", "L1-asymptotics.pdf")));
    const png = await renderPdfPage(deck, 2, 0.5);
    expect(png).not.toBeNull();
    expect(Buffer.from(png!.subarray(1, 4)).toString()).toBe("PNG");
  });
});
