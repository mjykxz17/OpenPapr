import { NextResponse } from "next/server";
import { getDb } from "@/server/db";
import { loadDeckPdf } from "@/server/deck";
import { renderPdfPage } from "@/lib/pdf-render";

// Renders a single slide (page) of a module's deck to PNG, so a study guide
// can embed the slide's actual figure inline. Uses a locally-converted PDF if
// present (e.g. from a PowerPoint deck), else the Canvas PDF. PDF-only.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const moduleId = Number(id);
  const url = new URL(request.url);
  const name = url.searchParams.get("name");
  const page = Number(url.searchParams.get("page"));
  if (!Number.isFinite(moduleId) || !name || !Number.isInteger(page) || page < 1) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  const res = await loadDeckPdf(getDb(), 1, moduleId, name);
  if ("error" in res) return NextResponse.json({ error: res.error }, { status: res.status });

  const png = await renderPdfPage(res.bytes, page);
  if (!png) return NextResponse.json({ error: "render failed" }, { status: 502 });
  return new NextResponse(Buffer.from(png), {
    headers: { "Content-Type": "image/png", "Cache-Control": "private, max-age=86400" },
  });
}
