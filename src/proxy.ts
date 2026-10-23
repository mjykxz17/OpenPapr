import { NextRequest, NextResponse } from "next/server";
import { verifySession } from "@/server/auth";
import { newNonce, pagePolicy } from "@/server/csp";

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
  const api = path.startsWith("/api");
  const allowed = OPEN.has(path) || path.startsWith("/api/login")
    // Calendar apps fetch the feed without a session; its URL token is checked by the route.
    || path.startsWith("/api/calendar/feed/")
    || verifySession(req.cookies.get("session")?.value, signingKey()) !== null;
  if (!allowed) {
    return api
      ? NextResponse.json({ error: "unauthorized" }, { status: 401 })
      : NextResponse.redirect(new URL("/login", req.url));
  }
  // The API needs no page policy: a file it serves carries its own sandboxed
  // one (see streamFile), and JSON needs none.
  return api ? NextResponse.next() : withPolicy(req);
}

// A page's policy carries a nonce of its own (server/csp.ts). Next reads it
// from the request's copy of the header and puts it on its own scripts; the
// layout reads x-nonce for the two it adds.
function withPolicy(req: NextRequest): NextResponse {
  const nonce = newNonce();
  const policy = pagePolicy(nonce);
  const headers = new Headers(req.headers);
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", policy);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set("Content-Security-Policy", policy);
  return res;
}
export const config = { matcher: ["/((?!_next|favicon.ico|icon.svg|apple-icon.png|manifest.webmanifest|sw\\.js|brand/).*)"] };
