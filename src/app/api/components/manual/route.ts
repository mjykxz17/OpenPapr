import { NextResponse } from "next/server";
import { getDb } from "@/server/db";
import { components } from "@/db/schema";

export async function POST(request: Request) {
  const { moduleId, name, weightPct, scorePct } = await request.json();
  getDb()
    .insert(components)
    .values({ moduleId, name, weightPct: weightPct ?? null, scorePct: scorePct ?? null, source: "manual" })
    .onConflictDoUpdate({
      target: [components.moduleId, components.name, components.source],
      set: { weightPct: weightPct ?? null, scorePct: scorePct ?? null },
    })
    .run();
  return NextResponse.json({ ok: true });
}
