import { execFile } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { limiter } from "./io";

// Lecture decks are mostly pictures stored at far higher resolution than any
// screen shows: IFS4103's first lecture is 22.7MB. Ghostscript re-saves the
// pictures at 300 dpi — indistinguishable on screen, text left as text — which
// took that deck to 3.4MB. qpdf then rewrites it without object streams, so
// every object sits at its own byte offset and PDF.js can fetch just the
// ranges a page needs. Measured on that deck at 20 Mbit/s: first page as fast
// as the original (~1.3s), jumping to slide 45 in 0.5s instead of 2.8s.
// Linearizing ("fast web view") was tried and made the first page slower in
// PDF.js (2.3s), so it is deliberately not used.
//
// Done once, when a deck enters the cache. A sidecar "<pdf>.opt" marks a file
// as handled (compressed or judged not worth it), so it is never redone.

export const markerPath = (pdf: string) => `${pdf}.opt`;
export const isOptimized = (pdf: string) => existsSync(markerPath(pdf));

function findBin(envName: string, names: string[]): string | null {
  const fromEnv = process.env[envName];
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  for (const dir of ["/usr/bin", "/usr/local/bin", "/opt/homebrew/bin"]) {
    for (const n of names) if (existsSync(join(dir, n))) return join(dir, n);
  }
  return null;
}
export const gsBin = () => findBin("GS_BIN", ["gs"]);
export const qpdfBin = () => findBin("QPDF_BIN", ["qpdf"]);

function run(bin: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout: timeoutMs, maxBuffer: 4 << 20 }, (err, stdout) => {
      // qpdf exits 3 for "succeeded with warnings", which is a success.
      if (err && !(bin.endsWith("qpdf") && (err as { code?: number }).code === 3)) reject(err);
      else resolve(String(stdout));
    });
  });
}

async function pageCount(qpdf: string, pdf: string): Promise<number | null> {
  try { return Number((await run(qpdf, ["--show-npages", pdf], 30_000)).trim()) || null; } catch { return null; }
}

export type OptimizeResult = { before: number; after: number; replaced: boolean; reason?: string };

// One at a time: each run is ~50MB and a few seconds, and the machine is small.
const slot = limiter(1);

// Keeps a smaller result only if it is at least 10% smaller and has the same
// page count; otherwise the original stays. Never throws.
export function optimizePdf(pdf: string, opts: { minSaving?: number; timeoutMs?: number } = {}): Promise<OptimizeResult> {
  return slot(() => optimizeNow(pdf, opts));
}

async function optimizeNow(pdf: string, { minSaving = 0.1, timeoutMs = 180_000 } = {}): Promise<OptimizeResult> {
  let before = 0;
  try { before = statSync(pdf).size; } catch { return { before: 0, after: 0, replaced: false, reason: "missing" }; }
  if (isOptimized(pdf)) return { before, after: before, replaced: false, reason: "already done" };
  const gs = gsBin();
  const qpdf = qpdfBin();
  if (!gs && !qpdf) return { before, after: before, replaced: false, reason: "no tools installed" };

  const work = mkdtempSync(join(tmpdir(), "op-pdf-"));
  const mark = (reason?: string) => { try { writeFileSync(markerPath(pdf), reason ?? ""); } catch { /* read-only */ } };
  try {
    let current = pdf;
    if (gs) {
      const out = join(work, "gs.pdf");
      await run(gs, [
        "-q", "-dNOPAUSE", "-dBATCH", "-dSAFER", "-sDEVICE=pdfwrite",
        "-dCompatibilityLevel=1.6", "-dPDFSETTINGS=/printer", "-dDetectDuplicateImages=true",
        "-dAutoRotatePages=/None", `-sOutputFile=${out}`, pdf,
      ], timeoutMs);
      current = out;
    }
    if (qpdf) {
      const out = join(work, "flat.pdf");
      await run(qpdf, ["--object-streams=disable", "--compress-streams=y", current, out], timeoutMs);
      current = out;
      const [a, b] = [await pageCount(qpdf, pdf), await pageCount(qpdf, current)];
      if (a !== null && b !== null && a !== b) { mark("page count changed"); return { before, after: before, replaced: false, reason: "page count changed" }; }
    }
    const after = statSync(current).size;
    if (after <= 0 || after > before * (1 - minSaving)) {
      mark("not worth it");
      return { before, after: before, replaced: false, reason: "saving too small" };
    }
    // Copied beside the target first (the work dir may be another
    // filesystem), then renamed over it in one step.
    const part = `${pdf}.${process.pid}.opt.part`;
    copyFileSync(current, part);
    renameSync(part, pdf);
    mark();
    return { before, after, replaced: true };
  } catch (err) {
    // A deck Ghostscript cannot read is served as it came; do not try again.
    mark(`failed: ${String(err instanceof Error ? err.message : err).slice(0, 120)}`);
    return { before, after: before, replaced: false, reason: "tool failed" };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
