import { NextResponse } from "next/server";
import { getDb } from "@/server/db";
import { currentUserId } from "@/server/session";
import { rateLimit } from "@/server/rate-limit";
import { createManualTask, isDay, isTime, sgtAt, USER_KINDS } from "@/server/tasks";

export const dynamic = "force-dynamic";

// Add a task by hand: a title, and optionally a day and a module.
export async function POST(request: Request) {
  const userId = await currentUserId();
  if (userId === null) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    return NextResponse.json({ error: "expected a JSON body" }, { status: 415 });
  }
  if (!rateLimit(`tasks-add:${userId}`, 60, 10 * 60_000)) return NextResponse.json({ error: "too many at once" }, { status: 429 });
  let body: Record<string, unknown>;
  try { body = (await request.json()) as Record<string, unknown>; } catch { return NextResponse.json({ error: "invalid body" }, { status: 400 }); }
  const title = typeof body.title === "string" ? body.title : "";
  if (body.due !== undefined && body.due !== null && body.due !== "" && !isDay(body.due)) return NextResponse.json({ error: "due must be YYYY-MM-DD" }, { status: 400 });
  if (body.time !== undefined && body.time !== null && !isTime(body.time)) return NextResponse.json({ error: "time must be HH:MM" }, { status: 400 });
  const dueAt = isDay(body.due) ? sgtAt(body.due, isTime(body.time) ? body.time : null) : null;
  const kind = USER_KINDS.find((k) => k === body.kind);
  const notes = typeof body.notes === "string" ? body.notes : null;
  const moduleId = typeof body.moduleId === "number" && Number.isInteger(body.moduleId) ? body.moduleId : null;
  const id = createManualTask(getDb(), userId, { title, dueAt, moduleId, kind, notes }, Date.now());
  return id === null ? NextResponse.json({ error: "give it a title" }, { status: 400 }) : NextResponse.json({ id });
}
