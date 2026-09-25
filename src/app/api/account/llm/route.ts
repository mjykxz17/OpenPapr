import { NextResponse } from "next/server";
import { getDb } from "@/server/db";
import { accountRequest, str } from "@/server/account-request";
import { checkLlmProvider } from "@/server/llm-check";
import { currentUserId } from "@/server/session";
import { clearLlmProvider, getUser, setLlmProvider, type LlmSlot } from "@/db/repo";
import { loadEnv } from "@/lib/env";
import { checkBaseUrl, parseExtra, RPM_MAX, secretHint, userLlmSlot } from "@/lib/llm-provider";

export const dynamic = "force-dynamic";

const slotOf = (v: unknown): LlmSlot => (v === "fallback" ? "fallback" : "primary");

// Saves the student's own model provider — the main one or the fallback —
// after one test call proves it works. The key is write-only: it is never sent
// back, only its last four. Leaving the key blank keeps the stored one, but
// only for the same base URL, so a stored key can never be redirected to a
// server someone else runs. rpm caps requests per minute (blank = no cap).
export async function PUT(request: Request) {
  const req = await accountRequest(request);
  if ("res" in req) return req.res;
  const env = loadEnv();
  const db = getDb();
  const slot = slotOf(req.body.slot);

  const url = checkBaseUrl(str(req.body.baseUrl));
  if (!url.ok) return NextResponse.json({ error: url.error }, { status: 400 });
  const model = str(req.body.model);
  if (!model || model.length > 200) return NextResponse.json({ error: "enter the model name" }, { status: 400 });

  const rpmRaw = req.body.rpm;
  let rpm: number | null = null;
  if (rpmRaw !== null && rpmRaw !== undefined && String(rpmRaw).trim() !== "") {
    rpm = Number(rpmRaw);
    if (!Number.isInteger(rpm) || rpm < 1 || rpm > RPM_MAX) {
      return NextResponse.json({ error: "requests per minute should be a whole number from 1, or blank for no limit" }, { status: 400 });
    }
  }

  const extra = parseExtra(typeof req.body.extra === "string" ? req.body.extra : "");
  if (!extra.ok) return NextResponse.json({ error: extra.error }, { status: 400 });

  let apiKey = str(req.body.apiKey);
  if (apiKey.length > 1000) return NextResponse.json({ error: "that key is too long" }, { status: 400 });
  if (!apiKey) {
    const user = getUser(db, req.userId);
    const stored = user ? userLlmSlot(user, slot, env.SECRET_KEY) : null;
    if (!stored || stored.baseUrl !== url.url) {
      return NextResponse.json({ error: "enter the API key" }, { status: 400 });
    }
    apiKey = stored.apiKey;
  }

  const cfg = { baseUrl: url.url, model, apiKey, rpm, extra: extra.value };
  const check = await checkLlmProvider(cfg);
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 });

  setLlmProvider(db, req.userId, cfg, env.SECRET_KEY, slot);
  return NextResponse.json({ ok: true, slot, baseUrl: cfg.baseUrl, model, rpm, extra: extra.value ? JSON.stringify(extra.value, null, 2) : "", keyHint: secretHint(apiKey) });
}

export async function DELETE(request: Request) {
  const userId = await currentUserId();
  if (userId === null) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  clearLlmProvider(getDb(), userId, slotOf(new URL(request.url).searchParams.get("slot")));
  return NextResponse.json({ ok: true });
}
