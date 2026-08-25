import { NextResponse } from "next/server";
import { currentUserId } from "@/server/session";
import { getDb } from "@/server/db";
import { loadDeckPdf, deckStem } from "@/server/deck";

// Streams a module's source slide deck (PDF) so the study guide's slide
// citations can open it at a given page. Serves a locally-converted PDF if
// present (e.g. from a PowerPoint deck), else the Canvas PDF.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await currentUserId();
  if (userId === null) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const moduleId = Number(id);
  const name = new URL(request.url).searchParams.get("name");
  if (!Number.isFinite(moduleId) || !name) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  const res = await loadDeckPdf(getDb(), userId, moduleId, name);
  if ("error" in res) return NextResponse.json({ error: res.error }, { status: res.status });
  return new NextResponse(Buffer.from(res.bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${deckStem(name)}.pdf"`,
      "Cache-Control": "private, max-age=3600",
    },
  });
}
