import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/server/db";
import { accountRequest } from "@/server/account-request";
import { currentUserId } from "@/server/session";
import { users } from "@/db/schema";
import { getModuleProfileRow, getWeeklyPlanRow, ownedModule, patchModuleProfile, patchWeeklyPlan, weekStartSgt } from "@/db/profiles-repo";

export const dynamic = "force-dynamic";

type Scope = "me" | "plan" | "module";
const scopeOf = (v: unknown): Scope | null => (v === "me" || v === "plan" || v === "module" ? v : null);

function status(db: ReturnType<typeof getDb>, userId: number, scope: Scope, moduleId: number) {
  if (scope === "me") {
    const u = db.select().from(users).where(eq(users.id, userId)).get()!;
    return { builtAt: u.profileAt, pending: Boolean(u.profileRequestedAt), error: u.profileError };
  }
  if (scope === "plan") {
    const p = getWeeklyPlanRow(db, userId);
    return { builtAt: p?.generatedAt ?? null, pending: Boolean(p?.requestedAt), error: p?.error ?? null };
  }
  const m = getModuleProfileRow(db, moduleId);
  return { builtAt: m?.generatedAt ?? null, pending: Boolean(m?.requestedAt), error: m?.error ?? null };
}

// Asks the worker to rebuild one profile now. The worker polls every couple
// of seconds, so the answer is usually back within a minute.
export async function POST(request: Request) {
  const req = await accountRequest(request);
  if ("res" in req) return req.res;
  const db = getDb();
  const scope = scopeOf(req.body.scope);
  const moduleId = Number(req.body.moduleId);
  if (!scope) return NextResponse.json({ error: "unknown scope" }, { status: 400 });
  const now = Date.now();
  if (scope === "me") db.update(users).set({ profileRequestedAt: now, profileError: null }).where(eq(users.id, req.userId)).run();
  if (scope === "plan") patchWeeklyPlan(db, req.userId, { requestedAt: now, error: null, ...(getWeeklyPlanRow(db, req.userId) ? {} : { weekStart: weekStartSgt(now) }) });
  if (scope === "module") {
    if (!ownedModule(db, req.userId, moduleId)) return NextResponse.json({ error: "not found" }, { status: 404 });
    patchModuleProfile(db, moduleId, { requestedAt: now, error: null });
  }
  return NextResponse.json({ ok: true, ...status(db, req.userId, scope, moduleId) });
}

export async function GET(request: Request) {
  const userId = await currentUserId();
  if (userId === null) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const url = new URL(request.url);
  const scope = scopeOf(url.searchParams.get("scope"));
  const moduleId = Number(url.searchParams.get("moduleId"));
  if (!scope) return NextResponse.json({ error: "unknown scope" }, { status: 400 });
  const db = getDb();
  if (scope === "module" && !ownedModule(db, userId, moduleId)) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(status(db, userId, scope, moduleId));
}
