import { NextResponse } from "next/server";
import { clearSessionCookie } from "@/server/session";

// Clears this device's session cookie. Sessions are signed cookies with no
// server-side store, so this signs out only here; "Sign out everywhere" on
// the Account page (/api/account/sessions/revoke) retires every copy by
// bumping the account's session version. Rotating SESSION_KEY signs out
// every account at once and leaves stored Canvas and Microsoft credentials
// intact.
export async function POST() {
  return clearSessionCookie(NextResponse.json({ ok: true }));
}
