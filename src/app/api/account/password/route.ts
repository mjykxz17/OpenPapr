import { NextResponse } from "next/server";
import { getDb } from "@/server/db";
import { accountRequest, str } from "@/server/account-request";
import { getUser, setCredentials } from "@/db/repo";
import { hashPassword, normalizeUsername, verifyPassword } from "@/server/password";

export const dynamic = "force-dynamic";

// Sets or changes the username and password. An account that already has a
// password must present it: a session left open on a shared machine should
// not be enough to lock the owner out.
export async function PUT(request: Request) {
  const req = await accountRequest(request);
  if ("res" in req) return req.res;
  const db = getDb();
  const user = getUser(db, req.userId);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const username = normalizeUsername(str(req.body.username)) || user.username || "";
  const next = str(req.body.newPassword);
  if (!/^[a-z0-9._-]{3,40}$/.test(username)) {
    return NextResponse.json({ error: "usernames are 3–40 letters, numbers, dots, dashes or underscores" }, { status: 400 });
  }
  if (next.length < 8) return NextResponse.json({ error: "choose a password of at least 8 characters" }, { status: 400 });
  if (user.passwordHash && !verifyPassword(str(req.body.currentPassword), user.passwordHash)) {
    return NextResponse.json({ error: "your current password is not right" }, { status: 401 });
  }
  if (!setCredentials(db, user.id, username, hashPassword(next))) {
    return NextResponse.json({ error: "that username is already taken" }, { status: 409 });
  }
  return NextResponse.json({ ok: true, username });
}
