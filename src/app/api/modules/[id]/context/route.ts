import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { currentUserId } from "@/server/session";
import { getDb } from "@/server/db";
import { modules } from "@/db/schema";
import { setModuleNotes } from "@/db/repo";
import { loadModuleContext } from "@/enrich/module-context";

export const dynamic = "force-dynamic";

// A student's notes are a few paragraphs; this is a guard against a pasted
// textbook, not a design limit. Everything here ends up inside a prompt.
const MAX_NOTES_CHARS = 20_000;

function owned(moduleId: number, userId: number) {
  if (!Number.isFinite(moduleId)) return null;
  const db = getDb();
  const mod = db.select().from(modules).where(and(eq(modules.id, moduleId), eq(modules.userId, userId))).get();
  return mod ? loadModuleContext(db, moduleId) : null;
}

// GET is the document exactly as the model will see it, for the module page
// and for anyone curious what the agent is told.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await currentUserId();
  if (userId === null) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const ctx = owned(Number(id), userId);
  if (!ctx) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({
    context: ctx.context,
    notes: ctx.input.notes,
    notesUpdatedAt: ctx.notesUpdatedAt,
    profile: ctx.input.profile,
    profiledAt: ctx.profiledAt,
    profileSource: ctx.profileSource,
  });
}

// PUT replaces the student's notes. The model's profile is not writable here:
// it is the model's own record, rewritten whenever the worker reads the decks.
//
// POST is the same write under a different verb, because the editor saves as
// you type and a tab closed mid-edit flushes the last keystrokes through
// navigator.sendBeacon, which can only POST.
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return PUT(request, ctx);
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await currentUserId();
  if (userId === null) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const moduleId = Number(id);
  const body = await request.json().catch(() => null);
  if (!Number.isFinite(moduleId) || typeof body?.notes !== "string" || body.notes.length > MAX_NOTES_CHARS) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  if (!setModuleNotes(getDb(), userId, moduleId, body.notes, Date.now())) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
