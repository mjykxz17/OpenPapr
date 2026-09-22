import { NextResponse } from "next/server";
import { getDb } from "@/server/db";
import { accountRequest, str } from "@/server/account-request";
import { replaceCanvasToken } from "@/db/repo";
import { createCanvasClient } from "@/connectors/canvas/client";
import { loadEnv } from "@/lib/env";
import { secretHint } from "@/lib/llm-provider";

export const dynamic = "force-dynamic";

// Swaps in a fresh Canvas token for the signed-in account — the fix for an
// expired token, without the invite code or signing out.
export async function PUT(request: Request) {
  const req = await accountRequest(request);
  if ("res" in req) return req.res;
  const token = str(req.body.token);
  if (!token || token.length > 400) return NextResponse.json({ error: "paste a Canvas access token" }, { status: 400 });

  const env = loadEnv();
  let self: { id: number; name: string };
  try {
    self = await createCanvasClient(env.CANVAS_BASE_URL, token).getSelf();
  } catch {
    return NextResponse.json({ error: "Canvas rejected that token. Check it was copied whole and has not expired." }, { status: 400 });
  }
  if (typeof self?.id !== "number") return NextResponse.json({ error: "unexpected response from Canvas" }, { status: 502 });

  const now = Date.now();
  const outcome = replaceCanvasToken(getDb(), req.userId, self, token, env.SECRET_KEY, now);
  if (outcome === "different-account") {
    return NextResponse.json({ error: "That token belongs to a different Canvas account." }, { status: 409 });
  }
  return NextResponse.json({ ok: true, name: self.name, tokenHint: secretHint(token), verifiedAt: now });
}
