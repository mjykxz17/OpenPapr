import { NextResponse } from "next/server";
import { currentUserId } from "@/server/session";
import { getDb } from "@/server/db";
import { getOverview } from "@/server/overview";
import { loadEnv } from "@/lib/env";
export const dynamic = "force-dynamic";
export async function GET() {
  const userId = await currentUserId();
  if (userId === null) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(getOverview(getDb(), userId, Date.now(), loadEnv().POLL_INTERVAL_MS));
}
