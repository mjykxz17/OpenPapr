import { PDFParse } from "pdf-parse";

// Renders one page of a PDF to PNG bytes, in-process (no subprocess/temp file).
// Used to embed a slide's figure inline in a study guide. Page is 1-based.
export async function renderPdfPage(bytes: Uint8Array, page: number, scale = 2): Promise<Uint8Array | null> {
  let parser: PDFParse | null = null;
  try {
    parser = new PDFParse({ data: bytes });
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
