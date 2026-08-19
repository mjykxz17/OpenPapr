import { describe, expect, it } from "vitest";
import { extractPdfText } from "./pdf-text";

// Build a minimal valid single-page PDF with correct xref offsets.
function minimalPdf(text: string): Uint8Array {
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    null, // stream obj built below
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  objs[3] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xrefAt = body.length;
  body += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) body += `${String(off).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF`;
  return new TextEncoder().encode(body);
}

describe("extractPdfText", () => {
  it("extracts text content from PDF bytes", async () => {
    const out = await extractPdfText(minimalPdf("Quizzes 17% Labs 28%"));
    expect(out).toContain("Quizzes 17%");
    expect(out).toContain("Labs 28%");
  });
  it("returns empty string on garbage bytes instead of throwing", async () => {
    expect(await extractPdfText(new TextEncoder().encode("not a pdf"))).toBe("");
  });
});
