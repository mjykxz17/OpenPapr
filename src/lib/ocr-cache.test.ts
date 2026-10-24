import { mkdtempSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cachedOcrText } from "./ocr-cache";

describe("cachedOcrText", () => {
  it("reads the cached OCR of this very PDF, and nothing else", () => {
    const dir = mkdtempSync(join(tmpdir(), "ocr-cache-"));
    const pdf = new TextEncoder().encode("%PDF-1.4 scan");
    const key = createHash("sha256").update(pdf).digest("hex").slice(0, 16);
    const path = join(dir, "L1.pdf.ocr.txt");
    expect(cachedOcrText(pdf, path)).toBeNull();
    writeFileSync(path, `${key}\nread off the page -- 1 of 1 --`);
    expect(cachedOcrText(pdf, path)).toBe("read off the page -- 1 of 1 --");
    expect(cachedOcrText(new TextEncoder().encode("%PDF-1.4 another"), path)).toBeNull();
  });
});
