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
import { appendToChat, getChat } from "@/server/pet-chats";

export const dynamic = "force-dynamic";

// Ask Papi something, inside a conversation. The conversation is stored, so
// its earlier turns give the model context and the student can come back to
// it. No sessionId starts a new one. With an AI provider the question is
// answered from a sheet of the student's own facts; without one, simple date
// questions still get an answer from the rules.
export async function POST(request: Request) {
  const userId = await currentUserId();
  if (userId === null) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    return NextResponse.json({ error: "expected a JSON body" }, { status: 415 });
  }
  if (!rateLimit(`pet:${userId}`, 40, 10 * 60_000)) return NextResponse.json({ reply: "I need a little breather — too many questions at once. Try again in a few minutes?" });
  let body: { message?: unknown; sessionId?: unknown };
  try { body = (await request.json()) as typeof body; } catch { return NextResponse.json({ error: "invalid body" }, { status: 400 }); }
  const question = typeof body.message === "string" ? body.message.trim().slice(0, 1000) : "";
  if (!question) return NextResponse.json({ error: "nothing to answer" }, { status: 400 });
  const sessionId = typeof body.sessionId === "number" && Number.isInteger(body.sessionId) ? body.sessionId : null;

  const db = getDb();
  const now = Date.now();
  const env = loadEnv();
  const user = getUser(db, userId);
  const cfg = (user && userLlmConfig(user, env.SECRET_KEY)) || sharedLlmConfig(env);
  const codes = db.select().from(modules).where(and(eq(modules.userId, userId), eq(modules.active, true))).all().map((m) => m.code);
  const fallback = () => ruleAnswer(question, dueList(db, userId, now), codes, now, recentlySaid(db, userId, now));
  const earlier = sessionId !== null ? (getChat(db, userId, sessionId)?.messages ?? []) : [];

  let reply: string;
  let smart = false;
  if (!cfg) reply = fallback();
  else {
    try {
      const out = await complete(cfg, [
        { role: "system", content: `${PET_SYSTEM}\n\nFACTS\n${factSheet(db, userId, now)}` },
        ...earlier.slice(-8).map((m) => ({ role: m.role, content: m.content })),
        { role: "user", content: question },
      ], { maxTokens: 400, temperature: 0.6, timeoutMs: 45_000 });
      reply = out.replace(/<think>[\s\S]*?<\/think>/g, "").replace(/\*\*(.+?)\*\*/g, "$1").replace(/^#+\s*/gm, "").trim() || fallback();
      smart = true;
    } catch {
      // The model is down or out of credit: the rules still know the dates.
      reply = `${fallback()} (My big brain is offline, so that's the short version.)`;
    }
  }
  const saved = appendToChat(db, userId, earlier.length ? sessionId : null, question, reply, now);
  return NextResponse.json({ reply, smart, sessionId: saved.id, title: saved.title });
}
