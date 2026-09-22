import { NextResponse } from "next/server";
import { currentUserId } from "@/server/session";
import { getDb } from "@/server/db";
import { ensureOriginal, ensurePdf, ownedFile, streamFile } from "@/server/files";
import { fileKind, servedType } from "@/lib/file-kind";

export const dynamic = "force-dynamic";

// The bytes behind the in-app viewer. ?as=pdf gives the PDF form (converting
// an office file on first request); ?download=1 asks the browser to save it.
export async function GET(request: Request, { params }: { params: Promise<{ id: string; fileId: string }> }) {
  const { id, fileId } = await params;
  const userId = await currentUserId();
  if (userId === null) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const db = getDb();
  const row = ownedFile(db, userId, Number(id), Number(fileId));
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });

  const url = new URL(request.url);
  const asPdf = url.searchParams.get("as") === "pdf";
  const download = url.searchParams.get("download") === "1";
  const served = asPdf ? await ensurePdf(db, userId, row) : await ensureOriginal(db, userId, row);
  if ("error" in served) return NextResponse.json({ error: served.error }, { status: served.status });

  const name = asPdf ? row.file.displayName.replace(/\.[^.]+$/, "") + ".pdf" : row.file.displayName;
  const type = asPdf ? "application/pdf" : servedType(row.file.displayName);
  // Only types the viewer renders are served inline; everything else is a
  // download, so an uploaded .html can never open as a page on this origin.
  const inline = !download && (asPdf || fileKind(row.file.displayName) !== "none");
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return streamFile(served, request, {
    "Content-Type": type,
    "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`,
  });
}
