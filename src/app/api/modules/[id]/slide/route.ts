import { NextResponse } from "next/server";
import { currentUserId } from "@/server/session";
import { getDb } from "@/server/db";
import { renderCachedSlide } from "@/server/deck";

// Renders a single slide (page) of a module's deck to PNG, so a study guide
// can embed the slide's actual figure inline and the slide panel can show it.
// `size=thumb` renders small for the panel's filmstrip. Rendered pages are
// cached on the volume beside the deck. PDF-only.
const SCALES = { full: 2, thumb: 0.35 } as const;

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await currentUserId();
  if (userId === null) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const moduleId = Number(id);
  const url = new URL(request.url);
  const name = url.searchParams.get("name");
  const page = Number(url.searchParams.get("page"));
  const scale = url.searchParams.get("size") === "thumb" ? SCALES.thumb : SCALES.full;
  if (!Number.isFinite(moduleId) || !name || !Number.isInteger(page) || page < 1) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  const res = await renderCachedSlide(getDb(), userId, moduleId, name, page, scale);
  if ("error" in res) return NextResponse.json({ error: res.error }, { status: res.status });
  return new NextResponse(Buffer.from(res.png), {
    headers: { "Content-Type": "image/png", "Cache-Control": "private, max-age=86400" },
  });
}
