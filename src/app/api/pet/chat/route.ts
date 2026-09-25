import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/server/db";
import { currentUserId } from "@/server/session";
import { rateLimit } from "@/server/rate-limit";
import { getUser } from "@/db/repo";
import { modules } from "@/db/schema";
import { loadEnv } from "@/lib/env";
import { sharedLlmConfig, userLlmConfig } from "@/lib/llm-provider";
import { complete } from "@/enrich/openai-compat";
import { PET_SYSTEM, dueList, factSheet, recentlySaid, ruleAnswer } from "@/server/pet";

export const dynamic = "force-dynamic";

type Msg = { role: "user" | "assistant"; content: string };

// Ask Papi something. With an AI provider the question is answered from a
// sheet of the student's own facts; without one, simple date questions still
// get an answer from the rules.
export async function POST(request: Request) {
  const userId = await currentUserId();
  if (userId === null) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    return NextResponse.json({ error: "expected a JSON body" }, { status: 415 });
  }
  if (!rateLimit(`pet:${userId}`, 40, 10 * 60_000)) return NextResponse.json({ reply: "I need a little breather — too many questions at once. Try again in a few minutes?" });
  let body: { messages?: unknown };
  try { body = (await request.json()) as { messages?: unknown }; } catch { return NextResponse.json({ error: "invalid body" }, { status: 400 }); }
  const messages: Msg[] = (Array.isArray(body.messages) ? body.messages : [])
    .filter((m): m is Msg => !!m && typeof m === "object" && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .slice(-8).map((m) => ({ role: m.role, content: m.content.slice(0, 1000) }));
  const last = [...messages].reverse().find((m) => m.role === "user");
  if (!last) return NextResponse.json({ error: "nothing to answer" }, { status: 400 });

  const db = getDb();
  const now = Date.now();
  const env = loadEnv();
  const user = getUser(db, userId);
  const cfg = (user && userLlmConfig(user, env.SECRET_KEY)) || sharedLlmConfig(env);
  const codes = db.select().from(modules).where(and(eq(modules.userId, userId), eq(modules.active, true))).all().map((m) => m.code);
  const fallback = () => ruleAnswer(last.content, dueList(db, userId, now), codes, now, recentlySaid(db, userId, now));

  if (!cfg) return NextResponse.json({ reply: fallback(), smart: false });
  try {
    const reply = await complete(cfg, [
      { role: "system", content: `${PET_SYSTEM}\n\nFACTS\n${factSheet(db, userId, now)}` },
      ...messages,
    ], { maxTokens: 400, temperature: 0.6, timeoutMs: 45_000 });
    const text = reply.replace(/<think>[\s\S]*?<\/think>/g, "").replace(/\*\*(.+?)\*\*/g, "$1").replace(/^#+\s*/gm, "").trim();
    return NextResponse.json({ reply: text || fallback(), smart: true });
  } catch {
    // The model is down or out of credit: the rules still know the dates.
    return NextResponse.json({ reply: `${fallback()} (My big brain is offline, so that's the short version.)`, smart: false });
  }
}
