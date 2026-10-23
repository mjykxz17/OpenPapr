import { NextResponse } from "next/server";
import { getDb } from "@/server/db";
import { accountRequest } from "@/server/account-request";
import { clearSessionCookie, endAllSessions } from "@/server/session";

export const dynamic = "force-dynamic";

// "Sign out everywhere": every session this account has — on a lost phone, a
// library computer — stops working, this one included. The shared demo
// account is refused by accountRequest: one visitor must not sign out all
// the others.
export async function POST(request: Request) {
  const req = await accountRequest(request);
  if ("res" in req) return req.res;
  endAllSessions(getDb(), req.userId);
  return clearSessionCookie(NextResponse.json({ ok: true }));
}
