import { NextResponse } from "next/server";
import { currentUserId } from "./session";
import { rateLimit } from "./rate-limit";

// Shared gate for the account routes. JSON only: a cross-site form can post
// text/plain without a preflight, but not application/json, so insisting on
// it closes the one hole SameSite=Lax leaves open.
export async function accountRequest(request: Request):
  Promise<{ userId: number; body: Record<string, unknown> } | { res: NextResponse }> {
  const userId = await currentUserId();
  if (userId === null) return { res: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    return { res: NextResponse.json({ error: "expected a JSON body" }, { status: 415 }) };
  }
  if (!rateLimit(`account:${userId}`, 20, 10 * 60_000)) {
    return { res: NextResponse.json({ error: "too many changes, try again in a few minutes" }, { status: 429 }) };
  }
  try {
    const body = (await request.json()) as unknown;
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("not an object");
    return { userId, body: body as Record<string, unknown> };
  } catch {
    return { res: NextResponse.json({ error: "invalid request body" }, { status: 400 }) };
  }
}

export const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
