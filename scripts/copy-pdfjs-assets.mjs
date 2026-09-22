// Copies PDF.js's worker and its font/cmap/wasm data into public/pdfjs, where
// the in-app viewer loads them from. Runs before dev and build, so the copy
// always matches the installed pdfjs-dist version; public/pdfjs is ignored by git.
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const src = join("node_modules", "pdfjs-dist");
const out = join("public", "pdfjs");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(join(src, "build", "pdf.worker.min.mjs"), join(out, "pdf.worker.min.mjs"));
for (const dir of ["cmaps", "standard_fonts", "wasm"]) cpSync(join(src, dir), join(out, dir), { recursive: true });
console.log("pdf.js assets copied to public/pdfjs");
