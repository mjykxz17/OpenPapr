import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

// What OCR already read off this PDF, as pdfTextWithOcr (ocr.ts) caches it
// beside the deck — "<key>\n<text>", the key a hash of the PDF — or null.
// For readers that cannot wait minutes for a scan to be read, and kept apart
// from ocr.ts so they do not pull its tesseract runner into the web server.
export function cachedOcrText(pdf: Uint8Array, cachePath: string): string | null {
  const key = createHash("sha256").update(pdf).digest("hex").slice(0, 16);
  try {
    const cached = readFileSync(cachePath, "utf8");
    return cached.startsWith(`${key}\n`) ? cached.slice(key.length + 1) : null;
  } catch { return null; }
}
