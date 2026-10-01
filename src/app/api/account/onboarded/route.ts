import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/server/db";
import { accountRequest } from "@/server/account-request";
import { users } from "@/db/schema";

export const dynamic = "force-dynamic";

// The welcome steps are finished, or skipped: Home stops sending them there.
export async function POST(request: Request) {
  const req = await accountRequest(request);
  if ("res" in req) return req.res;
  getDb().update(users).set({ onboardedAt: Date.now() }).where(eq(users.id, req.userId)).run();
  return NextResponse.json({ ok: true });
}
