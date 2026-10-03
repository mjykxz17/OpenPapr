import { NextResponse } from "next/server";
import { getDb } from "@/server/db";
import { currentUserId } from "@/server/session";
import { rateLimit } from "@/server/rate-limit";
import { deleteManualTask, updateTask, type TaskChange } from "@/server/tasks";

export const dynamic = "force-dynamic";

// Tick a step, mark a whole task done / not needed / open again, or correct
// the planner: not a real task, or the real due date.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await currentUserId();
  if (userId === null) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  // JSON only, which a cross-site form cannot send without a preflight.
  if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    return NextResponse.json({ error: "expected a JSON body" }, { status: 415 });
  }
  if (!rateLimit(`tasks:${userId}`, 300, 10 * 60_000)) return NextResponse.json({ error: "too many changes" }, { status: 429 });
  let body: Record<string, unknown>;
  try { body = (await request.json()) as Record<string, unknown>; } catch { return NextResponse.json({ error: "invalid body" }, { status: 400 }); }
  const { id } = await params;
  const status = body.status === "open" || body.status === "done" || body.status === "dismissed" ? body.status : undefined;
  const str = (k: string) => (typeof body[k] === "string" ? (body[k] as string) : undefined);
  const change: TaskChange = {
    status, stepId: str("stepId"), done: body.done === true, notTask: body.notTask === true, dueDate: str("dueDate"),
    time: body.time === null ? null : str("time"), noDate: body.noDate === true, title: str("title"),
    kind: str("kind") as TaskChange["kind"], notes: body.notes === null ? null : str("notes"),
    moduleId: body.moduleId === null ? null : typeof body.moduleId === "number" && Number.isInteger(body.moduleId) ? body.moduleId : undefined,
    started: typeof body.started === "boolean" ? body.started : undefined,
  };
  const any = Object.entries(change).some(([k, v]) => v !== undefined && !(k === "done" || ((k === "notTask" || k === "noDate") && v === false)));
  if (!any) return NextResponse.json({ error: "nothing to change" }, { status: 400 });
  const ok = updateTask(getDb(), userId, Number(id), change, Date.now());
  return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "not found" }, { status: 404 });
}

// Delete something the student added themselves.
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await currentUserId();
  if (userId === null) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!rateLimit(`tasks:${userId}`, 300, 10 * 60_000)) return NextResponse.json({ error: "too many changes" }, { status: 429 });
  const { id } = await params;
  return deleteManualTask(getDb(), userId, Number(id)) ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "not found" }, { status: 404 });
}
