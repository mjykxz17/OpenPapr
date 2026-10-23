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
