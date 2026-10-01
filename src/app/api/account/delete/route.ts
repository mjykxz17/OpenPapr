import { NextResponse } from "next/server";
import { currentUserId } from "@/server/session";
import { getDb } from "@/server/db";
import { getUser } from "@/db/repo";
import { deleteAccount } from "@/server/account-data";

// Deletes the account and everything in it, then signs out. The student types
// DELETE to confirm, so a stray click cannot do it.
export async function POST(request: Request) {
  const userId = await currentUserId();
  if (userId === null) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { confirm?: unknown } | null;
  if (body?.confirm !== "DELETE") return NextResponse.json({ error: "Type DELETE to confirm." }, { status: 400 });
  if (!getUser(getDb(), userId)) return NextResponse.json({ error: "not found" }, { status: 404 });
  deleteAccount(getDb(), userId);
  const res = NextResponse.json({ ok: true });
  res.cookies.set("session", "", { httpOnly: true, sameSite: "lax", secure: true, path: "/", maxAge: 0 });
  return res;
}
