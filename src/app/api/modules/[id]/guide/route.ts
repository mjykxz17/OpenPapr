import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { currentUserId } from "@/server/session";
import { getDb } from "@/server/db";
import { modules } from "@/db/schema";
import { canGenerateGuides } from "@/server/llm-access";
import { guideStatus, requestGuideRefresh } from "@/server/guide-status";

export const dynamic = "force-dynamic";

// The guide writes itself in the worker. GET says how far along it is; POST
// asks it to look at the slides again now, or ({rewrite: true}) to write
// every chapter afresh.
async function owned(id: string) {
  const userId = await currentUserId();
  if (userId === null) return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) } as const;
  const moduleId = Number(id);
  const mod = getDb().select().from(modules).where(and(eq(modules.id, moduleId), eq(modules.userId, userId))).get();
  if (!mod) return { error: NextResponse.json({ error: "not found" }, { status: 404 }) } as const;
  return { userId, mod } as const;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const o = await owned((await params).id);
  if ("error" in o) return o.error;
  if (!canGenerateGuides(getDb(), o.userId)) {
    return NextResponse.json({ error: "Add an AI key in Account so guides can be written." }, { status: 409 });
  }
  const body = (await request.json().catch(() => null)) as { rewrite?: unknown } | null;
  requestGuideRefresh(getDb(), o.mod.id, body?.rewrite === true);
  return NextResponse.json({ ok: true });
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const o = await owned((await params).id);
  if ("error" in o) return o.error;
  return NextResponse.json(guideStatus(getDb(), o.mod.id));
}
