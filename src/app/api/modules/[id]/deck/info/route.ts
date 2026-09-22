import { NextResponse } from "next/server";
import { currentUserId } from "@/server/session";
import { getDb } from "@/server/db";
import { loadDeckPdf } from "@/server/deck";
import { pdfPageCount } from "@/lib/pdf-render";

// How long a deck is, so the in-app viewer can bound its page controls.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await currentUserId();
  if (userId === null) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const moduleId = Number(id);
  const name = new URL(request.url).searchParams.get("name");
  if (!Number.isFinite(moduleId) || !name) return NextResponse.json({ error: "bad request" }, { status: 400 });

  const res = await loadDeckPdf(getDb(), userId, moduleId, name);
  if ("error" in res) return NextResponse.json({ error: res.error }, { status: res.status });
  const pages = await pdfPageCount(res.bytes);
  if (pages === null) return NextResponse.json({ error: "unreadable pdf" }, { status: 502 });
  return NextResponse.json({ pages }, { headers: { "Cache-Control": "private, max-age=86400" } });
}
