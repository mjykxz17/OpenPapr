// Local PDF → text for the OpenAI-compat LLM path (no document-block support).
// Fail-soft: any parse failure yields "" so a corrupt slide deck can never
// break a sync cycle.
import { PDFParse } from "pdf-parse";

export async function extractPdfText(bytes: Uint8Array): Promise<string> {
  let parser: PDFParse | null = null;
  try {
    parser = new PDFParse({ data: bytes });
    const result = await parser.getText();
    return result.text ?? "";
  } catch {
    return "";
  } finally {
    await parser?.destroy().catch(() => {});
  }
}
