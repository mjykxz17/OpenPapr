import { NextRequest, NextResponse } from "next/server";
import { verifySession } from "@/server/auth";

// The gate in front of every page and API route. Next 16 runs proxy on
// Node.js (middleware ran on the Edge runtime, which forced a Web Crypto copy
// of the check), so it shares server/auth.ts's verification. It stays cheap:
// signature and expiry only, no database. Whether the session is still
// current — the account exists, nobody signed it out everywhere — is checked
// by currentUserId in server/session.ts, which every page and route goes
// through to learn *which* user it is.
const OPEN = new Set(["/login", "/api/demo", "/api/health"]);

const signingKey = () => process.env.SESSION_KEY || process.env.SECRET_KEY || "";

export function proxy(req: NextRequest) {
  const path = req.nextUrl.pathname;
  if (OPEN.has(path) || path.startsWith("/api/login")) return NextResponse.next();
  // Calendar apps fetch the feed without a session; its URL token is checked by the route.
  if (path.startsWith("/api/calendar/feed/")) return NextResponse.next();
  if (verifySession(req.cookies.get("session")?.value, signingKey()) !== null) return NextResponse.next();
  return path.startsWith("/api")
    ? NextResponse.json({ error: "unauthorized" }, { status: 401 })
    : NextResponse.redirect(new URL("/login", req.url));
}
export const config = { matcher: ["/((?!_next|favicon.ico|icon.svg|apple-icon.png|manifest.webmanifest|sw\\.js|brand/).*)"] };
