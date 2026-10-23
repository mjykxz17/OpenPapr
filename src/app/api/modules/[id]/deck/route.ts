import { NextResponse } from "next/server";
import { currentUserId } from "@/server/session";
import { getDb } from "@/server/db";
import { existsSync, statSync } from "node:fs";
import { loadDeckPdf, deckStem } from "@/server/deck";
import { streamFile } from "@/server/files";

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
  // The file's stored name, never the one in the query string.
  const filename = `${deckStem(res.deck.file.displayName).replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_")}.pdf`;
  // Stream the cached copy (with ranges) rather than holding another copy of
  // a 20MB deck in memory for the response. Only when the file there is this
  // upload's: a classmate's same-named deck may sit at the same path.
  const cached = res.deck.path;
  if (res.onDisk && existsSync(cached)) {
    const s = statSync(cached);
    return streamFile({ path: cached, size: s.size, mtimeMs: s.mtimeMs }, request, {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
    });
  }
  return new NextResponse(Buffer.from(res.bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": "private, max-age=3600",
    },
  });
}
