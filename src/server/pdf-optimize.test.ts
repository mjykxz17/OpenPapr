import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gsBin, isOptimized, markerPath, optimizePdf, qpdfBin } from "./pdf-optimize";
import { backfillOptimize } from "../worker/maintenance";

const tools = Boolean(gsBin() && qpdfBin());

// A two-page "deck": a photo-like image at 600 dpi (the kind of oversized
// picture that makes real decks huge) plus a text page.
function makeDeck(dir: string): string {
  const out = join(dir, "deck.pdf");
  execFileSync("python3", ["-c", `
from PIL import Image, ImageDraw
import random
random.seed(1)
w, h = 3600, 2400
img = Image.new("RGB", (w, h))
px = img.load()
for y in range(h):
    for x in range(0, w, 3):
        v = (x * 255 // w + random.randint(0, 60)) % 256
        px[x, y] = (v, (y * 255 // h) % 256, (v + y) % 256)
page2 = Image.new("RGB", (1200, 800), "white")
ImageDraw.Draw(page2).text((50, 50), "Lecture 1 slide two", fill="black")
img.save(${JSON.stringify(out)}, "PDF", resolution=600, save_all=True, append_images=[page2], quality=95)
`]);
  return out;
}

describe.skipIf(!tools)("optimizePdf", () => {
  it("shrinks an image-heavy deck, keeps its pages, leaves no object streams, and marks it done", async () => {
    const dir = mkdtempSync(join(tmpdir(), "opt-"));
    const pdf = makeDeck(dir);
    const before = statSync(pdf).size;
    const r = await optimizePdf(pdf);
    expect(r.replaced).toBe(true);
    expect(r.after).toBeLessThan(before * 0.9);
    expect(statSync(pdf).size).toBe(r.after);
    expect(execFileSync(qpdfBin()!, ["--show-npages", pdf]).toString().trim()).toBe("2");
    expect(execFileSync(qpdfBin()!, ["--check", pdf]).toString()).toMatch(/No syntax or stream encoding errors/);
    expect(readFileSync(pdf, "latin1")).not.toMatch(/\/Type\s*\/ObjStm/);
    expect(isOptimized(pdf)).toBe(true);
    const again = await optimizePdf(pdf);
    expect(again).toMatchObject({ replaced: false, reason: "already done" });
  }, 60_000);

  it("leaves a file alone, and marks it, when the saving is too small", async () => {
    const dir = mkdtempSync(join(tmpdir(), "opt-"));
    const pdf = makeDeck(dir);
    await optimizePdf(pdf); // now already compact
    const copy = join(dir, "copy.pdf");
    copyFileSync(pdf, copy);
    const bytes = readFileSync(copy);
    const r = await optimizePdf(copy);
    expect(r.replaced).toBe(false);
    expect(readFileSync(copy).equals(bytes)).toBe(true);
    expect(existsSync(markerPath(copy))).toBe(true);
  }, 60_000);

  it("never throws on a file that is not a PDF", async () => {
    const dir = mkdtempSync(join(tmpdir(), "opt-"));
    const bad = join(dir, "bad.pdf");
    execFileSync("sh", ["-c", `printf 'not a pdf' > '${bad}'`]);
    const r = await optimizePdf(bad);
    expect(r.replaced).toBe(false);
    expect(readFileSync(bad, "utf8")).toBe("not a pdf");
  }, 60_000);

  it("backfills a cache directory", async () => {
    const dir = mkdtempSync(join(tmpdir(), "opt-"));
    makeDeck(dir);
    const r = await backfillOptimize(dir, 10);
    expect(r.done).toBe(1);
    expect(r.saved).toBeGreaterThan(0);
    expect((await backfillOptimize(dir, 10)).done).toBe(0);
  }, 60_000);
});
