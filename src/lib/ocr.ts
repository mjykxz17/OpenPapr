import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, renameSync, utimesSync, writeFileSync } from "node:fs";
import { PDFParse } from "pdf-parse";
import { extractPdfText } from "./pdf-text";

// Scanned decks — photocopied notes, slides exported as pictures — have no
// text layer, so the guide, Ask and slide hints all came up empty on them.
// When the tesseract binary is installed, such a deck's pages are rendered
// in-process (the same renderer that draws slide images) and read by OCR.
// A clean result is cached beside the PDF, so a deck is only read once.

// Under this many words a page, a deck is taken to be pictures of text.
const WORDS_PER_PAGE = 5;
const MIN_WORDS = 60;
const MAX_PAGES = 150;      // a scanned textbook is not read whole
const RENDER_BATCH = 8;
const PAGE_TIMEOUT = 60_000;
const RETRY_AFTER = 6 * 3_600_000;  // a read that lost pages, before it is run again

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
  return (await ocrPages(pdf, runner, maxPages)).text;
}

// lost: pages that would not render or that tesseract failed on (a timeout
// under load, missing language data), as against pages that are blank.
async function ocrPages(pdf: Uint8Array, runner: OcrRunner, maxPages = MAX_PAGES): Promise<{ text: string; lost: number }> {
  const total = await runner.pageCount(pdf);
  if (!total) return { text: "", lost: 1 };
  const pages = Array.from({ length: Math.min(total, maxPages) }, (_, i) => i + 1);
  const out: string[] = [];
  let lost = 0;
  for (let i = 0; i < pages.length; i += RENDER_BATCH) {
    const batch = pages.slice(i, i + RENDER_BATCH);
    const pngs = await runner.render(pdf, batch);
    for (const [k, page] of batch.entries()) {
      const png = pngs[k];
      let text = "";
      if (!png) lost++;
      else { try { text = (await runner.recognise(png)).trim(); } catch { lost++; } }
      out.push(`${text}\n\n-- ${page} of ${total} --\n`);
    }
  }
  return { text: out.join("\n"), lost };
}

// One OCR per deck at a time: the guide and the Ask index can ask for the
// same new scan at once. And a read that lost pages is not run again for a
// while, so every reader of that deck does not pay minutes for it.
const running = new Map<string, Promise<{ text: string; lost: number }>>();
const lostAt = new Map<string, number>();

// A PDF's text: its own text layer, or — when that is next to nothing and
// OCR is installed — what OCR reads off the pages, whichever says more.
// cachePath keeps the OCR text (keyed by the PDF's content) between calls.
// Only a complete read is kept; one that lost pages is tried again later.
export async function pdfTextWithOcr(pdf: Uint8Array, opts: { cachePath?: string; runner?: OcrRunner; extract?: (pdf: Uint8Array) => Promise<string>; now?: number } = {}): Promise<string> {
  // A copy: the parser may take ownership of the buffer it is given.
  const text = await (opts.extract ?? extractPdfText)(new Uint8Array(pdf));
  const runner = opts.runner ?? tesseract;
  if (!looksScanned(text) || !runner.available()) return text;
  const key = createHash("sha256").update(pdf).digest("hex").slice(0, 16);
  const now = opts.now ?? Date.now();
  let read: string | null = null;
  if (opts.cachePath) {
    try {
      const cached = readFileSync(opts.cachePath, "utf8");
      if (cached.startsWith(`${key}\n`)) {
        read = cached.slice(key.length + 1);
        // The volume is mounted noatime: mark it used, or cache eviction
        // takes it for the least used file and the deck is OCR'd again.
        try { const t = new Date(now); utimesSync(opts.cachePath, t, t); } catch { /* best effort */ }
      }
    } catch { /* not read yet */ }
  }
  if (read === null) {
    if (now - (lostAt.get(key) ?? -Infinity) < RETRY_AFTER) return text;
    let job = running.get(key);
    if (!job) {
      job = ocrPages(pdf, runner).catch(() => ({ text: "", lost: 1 })).finally(() => running.delete(key));
      running.set(key, job);
    }
    const r = await job;
    read = r.text;
    if (r.lost) lostAt.set(key, now);
    else if (opts.cachePath) {
      // Written aside and moved into place, so no reader sees half of it.
      const tmp = `${opts.cachePath}.${process.pid}.part`;
      try { writeFileSync(tmp, `${key}\n${read}`); renameSync(tmp, opts.cachePath); } catch { /* cache is best effort */ }
    }
  }
  return countWords(read) > countWords(text) ? read : text;
}

// --- the real runner: pdf-parse renders, tesseract reads ----------------------
// Installed, and with the English language data: without it every page
// fails, which would look like a deck with nothing on it.
let found: boolean | null = null;
function tesseractInstalled(): boolean {
  if (found === null) {
    try {
      const r = spawnSync(process.env.TESSERACT_BIN ?? "tesseract", ["--list-langs"], { encoding: "utf8", timeout: 10_000 });
      found = r.status === 0 && /^eng\s*$/m.test(`${r.stdout ?? ""}\n${r.stderr ?? ""}`);
    } catch { found = false; }
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
