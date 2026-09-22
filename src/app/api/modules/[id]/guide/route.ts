import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { currentUserId } from "@/server/session";
import { getDb } from "@/server/db";
import { latestGuideRun, requestGuide } from "@/db/repo";
import { modules } from "@/db/schema";
import { canGenerateGuides } from "@/server/llm-access";

export const dynamic = "force-dynamic";

// POST queues a generation; GET reports the latest run's progress. Generation
// takes minutes, so it cannot happen inside a request — the worker owns it and
// this is the queue plus the status window onto it.
async function ownedModule(moduleId: number, userId: number) {
  const mod = getDb().select().from(modules)
    .where(and(eq(modules.id, moduleId), eq(modules.userId, userId))).get();
  return mod;
}

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await currentUserId();
  if (userId === null) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const moduleId = Number(id);
  if (!(await ownedModule(moduleId, userId))) return NextResponse.json({ error: "not found" }, { status: 404 });

  if (!canGenerateGuides(getDb(), userId)) {
    return NextResponse.json({ error: "Add an AI key in Account to generate study guides." }, { status: 409 });
  }
  requestGuide(getDb(), userId, moduleId, Date.now());
  return NextResponse.json({ ok: true });
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await currentUserId();
  if (userId === null) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const moduleId = Number(id);
  if (!(await ownedModule(moduleId, userId))) return NextResponse.json({ error: "not found" }, { status: 404 });

  const run = latestGuideRun(getDb(), moduleId);
  if (!run) return NextResponse.json({ state: "idle" });
  return NextResponse.json({
    state: run.finishedAt ? (run.ok ? "done" : "failed") : "running",
    stage: run.stage,
    decksTotal: run.decksTotal,
    decksDone: run.decksDone,
    sectionsTotal: run.sectionsTotal,
    sectionsDone: run.sectionsDone,
    error: run.error,
    finishedAt: run.finishedAt,
  });
}
