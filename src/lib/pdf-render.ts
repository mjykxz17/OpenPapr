import { existsSync } from "node:fs";
import { join } from "node:path";
import { PDFParse } from "pdf-parse";

// Where pdf.js keeps the data it draws with: the standard fonts, the CJK
// character maps, and its image decoders. Most lecture decks do not embed
// Helvetica or Times (PowerPoint and LaTeX exports usually leave them out),
// and the PDF says to use the standard font. pdf.js ships those fonts, but
// only uses them when told where they are; otherwise it hands the text to
// the canvas as plain "sans-serif", which the server's Alpine image draws in
// a serif fallback. The browser viewer loads the same files from public/pdfjs.
// Both the web server and the worker run from the app's root.
export function pdfjsDataOptions(root: string = join(process.cwd(), "node_modules", "pdfjs-dist")) {
  if (!existsSync(join(root, "standard_fonts"))) return {};
  return {
    standardFontDataUrl: `${join(root, "standard_fonts")}/`,
    cMapUrl: `${join(root, "cmaps")}/`,
    cMapPacked: true,
    wasmUrl: `${join(root, "wasm")}/`,
  };
}

// Renders one page of a PDF to PNG bytes, in-process (no subprocess/temp file).
// Used to embed a slide's figure inline in a study guide. Page is 1-based.
export async function renderPdfPage(bytes: Uint8Array, page: number, scale = 2): Promise<Uint8Array | null> {
  let parser: PDFParse | null = null;
  try {
    parser = new PDFParse({ data: bytes, ...pdfjsDataOptions() });
    // `partial` selects specific 1-based pages; only that page is rendered.
    const shot = await parser.getScreenshot({ partial: [page], scale });
    const rendered = shot.pages?.find((p) => p.pageNumber === page) ?? shot.pages?.[0];
    return rendered?.data ? new Uint8Array(rendered.data) : null;
  } catch {
    return null;
  } finally {
    await parser?.destroy().catch(() => {});
  }
}

// Page count, for a viewer that needs to know where a deck ends.
export async function pdfPageCount(bytes: Uint8Array): Promise<number | null> {
  let parser: PDFParse | null = null;
  try {
    parser = new PDFParse({ data: bytes });
    const info = await parser.getInfo();
    return typeof info.total === "number" && info.total > 0 ? info.total : null;
  } catch {
    return null;
  } finally {
    await parser?.destroy().catch(() => {});
  }
}
