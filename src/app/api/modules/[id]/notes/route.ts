import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { currentUserId } from "@/server/session";
import { getDb } from "@/server/db";
import { modules } from "@/db/schema";
import { getSlideNote, listSlideNotes, upsertSlideNote } from "@/db/repo";

const MAX_NOTE = 20_000;

function ownsModule(userId: number, moduleId: number): boolean {
  const mod = getDb().select({ userId: modules.userId }).from(modules).where(eq(modules.id, moduleId)).get();
  return !!mod && mod.userId === userId;
}

// GET ?deck=&page=  → { markdown, updatedAt } for one slide (empty if none)
// GET               → { notes: [{ deck, page, markdown, updatedAt }] } for the module
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await currentUserId();
  if (userId === null) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const moduleId = Number(id);
  if (!Number.isFinite(moduleId) || !ownsModule(userId, moduleId)) return NextResponse.json({ error: "not found" }, { status: 404 });

  const url = new URL(request.url);
  const deck = url.searchParams.get("deck");
  const page = Number(url.searchParams.get("page"));
  if (deck && Number.isInteger(page) && page >= 1) {
    const note = getSlideNote(getDb(), userId, moduleId, deck, page);
    return NextResponse.json({ markdown: note?.markdown ?? "", updatedAt: note?.updatedAt ?? null });
  }
  return NextResponse.json({ notes: listSlideNotes(getDb(), userId, moduleId) });
}

// PUT { deck, page, markdown } — empty markdown deletes the note.
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await currentUserId();
  if (userId === null) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const moduleId = Number(id);
  if (!Number.isFinite(moduleId) || !ownsModule(userId, moduleId)) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = await request.json().catch(() => null);
  const deck = typeof body?.deck === "string" ? body.deck.trim() : "";
  const page = Number(body?.page);
  const markdown = typeof body?.markdown === "string" ? body.markdown : null;
  if (!deck || deck.length > 200 || !Number.isInteger(page) || page < 1 || markdown === null || markdown.length > MAX_NOTE) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  const now = Date.now();
  upsertSlideNote(getDb(), userId, moduleId, deck, page, markdown, now);
  return NextResponse.json({ ok: true, updatedAt: markdown.trim() === "" ? null : now });
}
