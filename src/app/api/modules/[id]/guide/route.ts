import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { currentUserId } from "@/server/session";
import { getDb } from "@/server/db";
import { latestGuideRun, requestGuide } from "@/db/repo";
import { files, modules } from "@/db/schema";
import { fileKind } from "@/lib/file-kind";
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

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await currentUserId();
  if (userId === null) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const moduleId = Number(id);
  if (!(await ownedModule(moduleId, userId))) return NextResponse.json({ error: "not found" }, { status: 404 });

  if (!canGenerateGuides(getDb(), userId)) {
    return NextResponse.json({ error: "Add an AI key in Account to generate study guides." }, { status: 409 });
  }
  // Optional JSON body: {fileIds, mode}. No body keeps the old behaviour —
  // every lecture deck, whole guide rebuilt.
  let fileIds: number[] | null = null;
  let mode: "replace" | "merge" = "replace";
  if ((request.headers.get("content-type") ?? "").startsWith("application/json")) {
    const body = (await request.json().catch(() => null)) as { fileIds?: unknown; mode?: unknown } | null;
    if (body?.mode === "merge") mode = "merge";
    if (Array.isArray(body?.fileIds)) {
      const wanted = new Set(body.fileIds.map(Number).filter(Number.isInteger));
      const valid = getDb().select().from(files).where(eq(files.moduleId, moduleId)).all()
        .filter((f) => wanted.has(f.id) && ["pdf", "office"].includes(fileKind(f.displayName)))
        .map((f) => f.id);
      if (valid.length === 0) return NextResponse.json({ error: "choose at least one PDF or slide deck" }, { status: 400 });
      if (valid.length > 30) return NextResponse.json({ error: "choose at most 30 files at a time" }, { status: 400 });
      fileIds = valid;
    }
  }
  const state = requestGuide(getDb(), userId, moduleId, Date.now(), { fileIds, mode });
  if (state === "busy") return NextResponse.json({ error: "a guide is already being written for this module — wait for it to finish" }, { status: 409 });
  return NextResponse.json({ ok: true, state });
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
