import { NextResponse } from "next/server";

// Clears the session cookie. There is no server-side session store to purge:
// sessions are stateless signed cookies, so signing out is entirely a matter
// of removing the client's copy. To invalidate sessions everywhere at once —
// after a leak, say — rotate SESSION_KEY, which leaves stored Canvas and
// Microsoft credentials intact.
export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set("session", "", {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/",
    maxAge: 0,
  });
  return res;
}
