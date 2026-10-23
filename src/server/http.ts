import { NextResponse } from "next/server";

// JSON only, for routes that change something. A cross-site form can post
// text/plain without a preflight, but not application/json, so insisting on
// it closes the one hole SameSite=Lax leaves open.
export const isJsonRequest = (request: Request) =>
  (request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json");

// The 415 to hand back, or null when the request is JSON.
export function requireJson(request: Request): NextResponse | null {
  return isJsonRequest(request) ? null : NextResponse.json({ error: "expected a JSON body" }, { status: 415 });
}

// Where the site lives, for links that leave it (a calendar feed's "open in
// OpenPapr"). Never the request's Host header: anyone can send any Host, and
// the link would then point wherever they liked. PUBLIC_URL when set, else
// the Fly app's own address, else this machine for local development.
let warnedLocalhost = false;
export function publicBaseUrl(env: Record<string, string | undefined> = process.env): string {
  const set = env.PUBLIC_URL?.trim();
  if (set) {
    try {
      const u = new URL(set);
      if (u.protocol === "https:" || u.protocol === "http:") return u.origin;
    } catch {
      // A mistyped PUBLIC_URL falls back below rather than breaking links.
    }
  }
  if (env.FLY_APP_NAME && /^[a-z0-9-]+$/.test(env.FLY_APP_NAME)) return `https://${env.FLY_APP_NAME}.fly.dev`;
  // Right for development, wrong for a server people use, whose calendar
  // links would all point at localhost. Said once, not on every feed fetch.
  if (env.NODE_ENV === "production" && !warnedLocalhost) {
    warnedLocalhost = true;
    console.warn("PUBLIC_URL is not set, so calendar feed links point at localhost. Set it to the address students open the site at.");
  }
  return `http://localhost:${Number(env.PORT) || 3000}`;
}
