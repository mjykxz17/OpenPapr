import { existsSync, mkdtempSync, readFileSync, statSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { looksScanned, ocrPdf, pdfTextWithOcr, type OcrRunner } from "./ocr";

const scanText = (pages: number) => Array.from({ length: pages }, (_, i) => `\n\n-- ${i + 1} of ${pages} --\n`).join("");
const prose = (pages: number) => Array.from({ length: pages }, (_, i) => `${"real words on the slide ".repeat(6)}\n\n-- ${i + 1} of ${pages} --\n`).join("");

// A runner that "reads" each page as a line naming it.
function fakeRunner(pages: number, available = true) {
  const recognise = vi.fn(async (png: Uint8Array) => `Page ${png[0]} says binary search halves the interval each step`);
  const runner: OcrRunner = {
    available: () => available,
    pageCount: async () => pages,
    render: async (_pdf, list) => list.map((n) => new Uint8Array([n])),
    recognise,
  };
  return { runner, recognise };
}

describe("looksScanned", () => {
  it("is true for pages without words, false for real slides", () => {
    expect(looksScanned(scanText(20))).toBe(true);
    expect(looksScanned(prose(20))).toBe(false);
    // Page numbers alone on 40 slides are not a text layer.
    expect(looksScanned(Array.from({ length: 40 }, (_, i) => `${i + 1} intro\n-- ${i + 1} of 40 --`).join("\n"))).toBe(true);
  });
});

describe("ocrPdf", () => {
  it("writes each page with its marker, as pdf-parse would", async () => {
    const { runner } = fakeRunner(3);
    const text = await ocrPdf(new Uint8Array([1]), runner);
    expect(text).toContain("Page 2 says binary search");
    expect(text).toMatch(/Page 3 says[^\n]*\n\n-- 3 of 3 --/);
  });

  it("stops at the page cap", async () => {
    const { runner, recognise } = fakeRunner(20);
    await ocrPdf(new Uint8Array([1]), runner, 5);
    expect(recognise).toHaveBeenCalledTimes(5);
  });
});

describe("pdfTextWithOcr", () => {
  const pdf = new Uint8Array([9, 9, 9]);

  it("reads a scanned deck by OCR, once, and keeps the result beside it", async () => {
    const { runner, recognise } = fakeRunner(4);
    const cachePath = join(mkdtempSync(join(tmpdir(), "ocr-")), "deck.pdf.ocr.txt");
    const extract = async () => scanText(4);
    const first = await pdfTextWithOcr(pdf, { runner, extract, cachePath });
    expect(first).toContain("Page 1 says");
    expect(readFileSync(cachePath, "utf8")).toContain("Page 4 says");
    expect(await pdfTextWithOcr(pdf, { runner, extract, cachePath })).toBe(first);
    expect(recognise).toHaveBeenCalledTimes(4);
  });

  it("leaves a deck with a text layer alone", async () => {
    const { runner, recognise } = fakeRunner(4);
    const text = prose(4);
    expect(await pdfTextWithOcr(pdf, { runner, extract: async () => text })).toBe(text);
    expect(recognise).not.toHaveBeenCalled();
  });

  it("does not keep a read that lost pages, and tries it again later", async () => {
    const scan = new Uint8Array([7, 7, 1]);
    const { runner, recognise } = fakeRunner(4);
    let failing = true;
    recognise.mockImplementation(async (png: Uint8Array) => {
      if (failing && png[0] === 2) throw new Error("tesseract exited with null");   // a page timed out
      return `Page ${png[0]} says binary search halves the interval each step`;
    });
    const cachePath = join(mkdtempSync(join(tmpdir(), "ocr-")), "deck.pdf.ocr.txt");
    const extract = async () => scanText(4);
    const T = 1_000_000_000;
    expect(await pdfTextWithOcr(scan, { runner, extract, cachePath, now: T })).toContain("Page 3 says");
    expect(existsSync(cachePath)).toBe(false);                             // not cached
    expect(recognise).toHaveBeenCalledTimes(4);
    await pdfTextWithOcr(scan, { runner, extract, cachePath, now: T + 60_000 });
    expect(recognise).toHaveBeenCalledTimes(4);                            // not straight away again
    failing = false;
    expect(await pdfTextWithOcr(scan, { runner, extract, cachePath, now: T + 7 * 3_600_000 })).toContain("Page 2 says");
    expect(recognise).toHaveBeenCalledTimes(8);
    expect(readFileSync(cachePath, "utf8")).toContain("Page 2 says");      // now it is
  });

  it("reads one deck once when two readers ask at the same time, and marks the cache used", async () => {
    const scan = new Uint8Array([7, 7, 2]);
    const { runner, recognise } = fakeRunner(3);
    const cachePath = join(mkdtempSync(join(tmpdir(), "ocr-")), "deck.pdf.ocr.txt");
    const extract = async () => scanText(3);
    const [a, b] = await Promise.all([pdfTextWithOcr(scan, { runner, extract, cachePath }), pdfTextWithOcr(scan, { runner, extract, cachePath })]);
    expect(a).toBe(b);
    expect(recognise).toHaveBeenCalledTimes(3);
    utimesSync(cachePath, new Date(1000), new Date(1000));
    await pdfTextWithOcr(scan, { runner, extract, cachePath, now: 5_000_000 });
    expect(statSync(cachePath).mtimeMs).toBe(5_000_000);
  });

  it("gives the text layer back when OCR is not installed", async () => {
    const { runner } = fakeRunner(4, false);
    expect(await pdfTextWithOcr(pdf, { runner, extract: async () => scanText(4) })).toBe(scanText(4));
  });
});
