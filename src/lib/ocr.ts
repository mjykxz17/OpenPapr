import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { PDFParse } from "pdf-parse";
import { extractPdfText } from "./pdf-text";

// Scanned decks — photocopied notes, slides exported as pictures — have no
// text layer, so the guide, Ask and slide hints all came up empty on them.
// When the tesseract binary is installed, such a deck's pages are rendered
// in-process (the same renderer that draws slide images) and read by OCR.
// The result is cached beside the PDF, so a deck is only ever read once.

// Under this many words a page, a deck is taken to be pictures of text.
const WORDS_PER_PAGE = 5;
const MIN_WORDS = 60;
const MAX_PAGES = 150;      // a scanned textbook is not read whole
const RENDER_BATCH = 8;
const PAGE_TIMEOUT = 60_000;

const pageMarks = /--\s*\d+\s*of\s*(\d+)\s*--/g;
const countWords = (text: string) => (text.replace(pageMarks, " ").toLowerCase().match(/[a-z0-9]+/g) ?? []).length;

export function looksScanned(text: string): boolean {
  const pages = Number(/--\s*\d+\s*of\s*(\d+)\s*--/.exec(text)?.[1] ?? 0);
  const words = countWords(text);
  return words < MIN_WORDS || (pages > 0 && words < pages * WORDS_PER_PAGE);
}

export type OcrRunner = {
  available: () => boolean;
  pageCount: (pdf: Uint8Array) => Promise<number>;
  // PNGs of the given 1-based pages, in order; null for a page that would not render.
  render: (pdf: Uint8Array, pages: number[]) => Promise<(Uint8Array | null)[]>;
  recognise: (png: Uint8Array) => Promise<string>;
};

// The deck's text the way pdf-parse writes it — each page followed by its
// "-- N of M --" marker — so everything downstream reads it unchanged.
export async function ocrPdf(pdf: Uint8Array, runner: OcrRunner, maxPages = MAX_PAGES): Promise<string> {
  const total = await runner.pageCount(pdf);
  if (!total) return "";
  const pages = Array.from({ length: Math.min(total, maxPages) }, (_, i) => i + 1);
  const out: string[] = [];
  for (let i = 0; i < pages.length; i += RENDER_BATCH) {
    const batch = pages.slice(i, i + RENDER_BATCH);
    const pngs = await runner.render(pdf, batch);
    for (const [k, page] of batch.entries()) {
      const png = pngs[k];
      let text = "";
      if (png) { try { text = (await runner.recognise(png)).trim(); } catch { text = ""; } }
      out.push(`${text}\n\n-- ${page} of ${total} --\n`);
    }
  }
  return out.join("\n");
}

// A PDF's text: its own text layer, or — when that is next to nothing and
// OCR is installed — what OCR reads off the pages, whichever says more.
// cachePath keeps the OCR text (keyed by the PDF's content) between calls.
export async function pdfTextWithOcr(pdf: Uint8Array, opts: { cachePath?: string; runner?: OcrRunner; extract?: (pdf: Uint8Array) => Promise<string> } = {}): Promise<string> {
  // A copy: the parser may take ownership of the buffer it is given.
  const text = await (opts.extract ?? extractPdfText)(new Uint8Array(pdf));
  const runner = opts.runner ?? tesseract;
  if (!looksScanned(text) || !runner.available()) return text;
  const key = createHash("sha256").update(pdf).digest("hex").slice(0, 16);
  let read: string | null = null;
  if (opts.cachePath) {
    try {
      const cached = readFileSync(opts.cachePath, "utf8");
      if (cached.startsWith(`${key}\n`)) read = cached.slice(key.length + 1);
    } catch { /* not read yet */ }
  }
  if (read === null) {
    read = await ocrPdf(pdf, runner).catch(() => "");
    if (opts.cachePath) { try { writeFileSync(opts.cachePath, `${key}\n${read}`); } catch { /* cache is best effort */ } }
  }
  return countWords(read) > countWords(text) ? read : text;
}

// --- the real runner: pdf-parse renders, tesseract reads ----------------------
let found: boolean | null = null;
function tesseractInstalled(): boolean {
  if (found === null) {
    try { found = spawnSync(process.env.TESSERACT_BIN ?? "tesseract", ["--version"], { stdio: "ignore", timeout: 10_000 }).status === 0; } catch { found = false; }
  }
  return found;
}

export const tesseract: OcrRunner = {
  available: tesseractInstalled,
  async pageCount(pdf) {
    const parser = new PDFParse({ data: new Uint8Array(pdf) });
    try { return (await parser.getInfo()).total ?? 0; } catch { return 0; } finally { await parser.destroy().catch(() => {}); }
  },
  async render(pdf, pages) {
    const parser = new PDFParse({ data: new Uint8Array(pdf) });
    try {
      const shot = await parser.getScreenshot({ partial: pages, scale: 2 });
      return pages.map((n) => {
        const p = shot.pages?.find((x) => x.pageNumber === n);
        return p?.data ? new Uint8Array(p.data) : null;
      });
    } catch {
      return pages.map(() => null);
    } finally {
      await parser.destroy().catch(() => {});
    }
  },
  recognise(png) {
    return new Promise((resolve, reject) => {
      const child = spawn(process.env.TESSERACT_BIN ?? "tesseract", ["stdin", "stdout", "-l", "eng"], { stdio: ["pipe", "pipe", "ignore"] });
      const chunks: Buffer[] = [];
      const timer = setTimeout(() => child.kill("SIGKILL"), PAGE_TIMEOUT);
      child.stdout.on("data", (c: Buffer) => chunks.push(c));
      child.on("error", (e) => { clearTimeout(timer); reject(e); });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code === 0) resolve(Buffer.concat(chunks).toString("utf8"));
        else reject(new Error(`tesseract exited with ${code}`));
      });
      child.stdin.on("error", () => { /* it exited early; close reports why */ });
      child.stdin.end(Buffer.from(png));
    });
  },
};
