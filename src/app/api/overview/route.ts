import { NextResponse } from "next/server";
import { getDb } from "@/server/db";
import { getOverview } from "@/server/overview";
import { loadEnv } from "@/lib/env";
export const dynamic = "force-dynamic";
export function GET() {
  // TODO(phase-3): session → userId
  return NextResponse.json(getOverview(getDb(), 1, Date.now(), loadEnv().POLL_INTERVAL_MS));
}
