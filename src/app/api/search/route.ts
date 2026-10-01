import { NextResponse } from "next/server";
import { getDb } from "@/server/db";
import { currentUserId } from "@/server/session";
import { rateLimit } from "@/server/rate-limit";
import { search } from "@/server/search";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const userId = await currentUserId();
  if (userId === null) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!rateLimit(`search:${userId}`, 600, 10 * 60_000)) return NextResponse.json({ results: [] }, { status: 429 });
  const q = (new URL(request.url).searchParams.get("q") ?? "").slice(0, 200);
  const results = search(getDb(), userId, q, Date.now()).map(({ score: _score, ...r }) => r);
  return NextResponse.json({ results });
}
