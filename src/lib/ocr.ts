import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, readFileSync, renameSync, rmSync, utimesSync, writeFileSync } from "node:fs";
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

// What a read is told and tells as it goes: pages already read by an earlier
// run, pages to pass over, and each step as it happens.
type Hooks = {
  done?: Map<number, string>;
  skip?: Set<number>;
  rendering?: (pages: number[]) => void;
  reading?: (page: number) => void;
  read?: (page: number, text: string | null) => void;   // null: lost
};

// lost: pages that would not render or that tesseract failed on (a timeout
// under load, missing language data), as against pages that are blank.
async function ocrPages(pdf: Uint8Array, runner: OcrRunner, maxPages = MAX_PAGES, hooks: Hooks = {}): Promise<{ text: string; lost: number }> {
  const total = await runner.pageCount(pdf);
  if (!total) return { text: "", lost: 1 };
  const pages = Array.from({ length: Math.min(total, maxPages) }, (_, i) => i + 1);
  const { done = new Map<number, string>(), skip = new Set<number>() } = hooks;
  const out: string[] = [];
  let lost = 0;
  for (let i = 0; i < pages.length; i += RENDER_BATCH) {
    const batch = pages.slice(i, i + RENDER_BATCH);
    const todo = batch.filter((p) => !done.has(p) && !skip.has(p));
    if (todo.length) hooks.rendering?.(todo);
    const pngs = todo.length ? await runner.render(pdf, todo) : [];
    for (const page of batch) {
      let text = done.get(page);
      if (text === undefined) {
        const png = skip.has(page) ? null : pngs[todo.indexOf(page)];
        text = "";
        let ok = false;
        if (png) {
          hooks.reading?.(page);
          try { text = (await runner.recognise(png)).trim(); ok = true; } catch { /* lost */ }
        }
        if (!ok) lost++;
        if (!skip.has(page)) hooks.read?.(page, ok ? text : null);
      }
      out.push(`${text}\n\n-- ${page} of ${total} --\n`);
    }
  }
  return { text: out.join("\n"), lost };
}

// --- a long read, kept page by page --------------------------------------------
// A scan of 150 pages takes many minutes, and the worker can be restarted
// in the middle (a deploy, memory, the watchdog). Each page is written to
// "<cache>.pages" as soon as it is read, so the next run picks up where the
// last one stopped instead of at page 1. Pages that were being rendered or
// read when the process died are the likely cause of it, so the next run
// passes over them (they count as lost, and are tried again later) rather
// than walk into the same crash straight away.
type Line = { b?: number[]; p?: number; t?: string; lost?: true };
function pageLog(path: string, key: string) {
  const done = new Map<number, string>();
  const skip = new Set<number>();
  let lines: Line[] = [];
  try {
    const [head, ...rest] = readFileSync(path, "utf8").split("\n");
    if (head === key) lines = rest.filter(Boolean).map((l) => { try { return JSON.parse(l) as Line; } catch { return {}; } });
  } catch { /* nothing kept yet */ }
  const started = new Set<number>(), finished = new Set<number>();
  for (const l of lines) {
    if (l.p === undefined) continue;
    if (typeof l.t === "string") { done.set(l.p, l.t); finished.add(l.p); }
    else if (l.lost) finished.add(l.p);
    else started.add(l.p);
  }
  for (const p of started) if (!finished.has(p)) skip.add(p);
  // A batch that never got as far as reading any page died while rendering.
  for (const l of lines) if (l.b && !l.b.some((p) => started.has(p) || finished.has(p))) l.b.forEach((p) => skip.add(p));
  const write = (text: string, append = true) => { try { (append ? appendFileSync : writeFileSync)(path, text); } catch { /* best effort */ } };
  if (!lines.length) write(`${key}\n`, false);
  const add = (l: Line) => write(`${JSON.stringify(l)}\n`);
  return {
    done, skip,
    rendering: (pages: number[]) => add({ b: pages }),
    reading: (page: number) => add({ p: page }),
    read: (page: number, text: string | null) => { if (text !== null) done.set(page, text); add(text === null ? { p: page, lost: true } : { p: page, t: text }); },
    // A complete read is cached whole: the log has done its job.
    finish: () => { try { rmSync(path, { force: true }); } catch { /* best effort */ } },
    // A read that lost pages keeps the ones it got; the rest are tried again.
    keepRead: () => write(`${key}\n${[...done].map(([p, t]) => `${JSON.stringify({ p, t })}\n`).join("")}`, false),
  };
}

// One OCR per deck at a time: the guide and the Ask index can ask for the
// same new scan at once. And a read that lost pages is not run again for a
// while, so every reader of that deck does not pay minutes for it. Everyone
// waiting on a read hears of each page it finishes (onProgress).
type Job = { result: Promise<{ text: string; lost: number }>; listeners: Set<() => void>; cachePath?: string };
const running = new Map<string, Job>();
const lostAt = new Map<string, number>();

// A PDF's text: its own text layer, or — when that is next to nothing and
// OCR is installed — what OCR reads off the pages, whichever says more.
// cachePath keeps the OCR text (keyed by the PDF's content) between calls.
// Only a complete read is kept; one that lost pages is tried again later.
// onProgress is called as each page is done, so a watchdog can tell a long
// read from a stuck one.
export async function pdfTextWithOcr(pdf: Uint8Array, opts: { cachePath?: string; runner?: OcrRunner; extract?: (pdf: Uint8Array) => Promise<string>; now?: number; onProgress?: () => void } = {}): Promise<string> {
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
      const listeners = new Set<() => void>();
      const tick = () => { for (const f of listeners) { try { f(); } catch { /* a listener's problem */ } } };
      const cachePath = opts.cachePath;
      const log = cachePath ? pageLog(`${cachePath}.pages`, key) : null;
      const result = ocrPages(pdf, runner, MAX_PAGES, {
        done: log?.done, skip: log?.skip, rendering: log?.rendering, reading: log?.reading,
        read: (page, t) => { log?.read(page, t); tick(); },
      }).then((r) => {
        // The whole text is in the cache before the page log goes.
        if (!r.lost && cachePath) keep(cachePath, key, r.text);
        if (log) { if (r.lost) log.keepRead(); else log.finish(); }
        return r;
      }).catch(() => ({ text: "", lost: 1 })).finally(() => running.delete(key));
      job = { result, listeners, cachePath };
      running.set(key, job);
    }
    const onProgress = opts.onProgress;
    if (onProgress) job.listeners.add(onProgress);
    let r: { text: string; lost: number };
    try { r = await job.result; } finally { if (onProgress) job.listeners.delete(onProgress); }
    read = r.text;
    if (r.lost) lostAt.set(key, now);
    else if (opts.cachePath && opts.cachePath !== job.cachePath) keep(opts.cachePath, key, read);   // a second copy of the same deck
  }
  return countWords(read) > countWords(text) ? read : text;
}

// Written aside and moved into place, so no reader sees half of it.
function keep(cachePath: string, key: string, text: string): void {
  const tmp = `${cachePath}.${process.pid}.part`;
  try { writeFileSync(tmp, `${key}\n${text}`); renameSync(tmp, cachePath); } catch { /* cache is best effort */ }
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
