import { NextResponse } from "next/server";
import { getDb } from "@/server/db";
import { currentUserId } from "@/server/session";
import { rateLimit } from "@/server/rate-limit";
import { updateTask } from "@/server/tasks";

export const dynamic = "force-dynamic";

// Tick a step, or mark a whole task done / not needed / open again.
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
  const stepId = typeof body.stepId === "string" ? body.stepId : undefined;
  if (!status && stepId === undefined) return NextResponse.json({ error: "nothing to change" }, { status: 400 });
  const ok = updateTask(getDb(), userId, Number(id), { stepId, done: body.done === true, status }, Date.now());
  return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "not found" }, { status: 404 });
}
