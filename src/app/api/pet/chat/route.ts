import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/server/db";
import { currentUserId } from "@/server/session";
import { rateLimit } from "@/server/rate-limit";
import { getUser } from "@/db/repo";
import { modules } from "@/db/schema";
import { loadEnv } from "@/lib/env";
import { cfgForUser } from "@/server/llm-config";
import { complete } from "@/enrich/openai-compat";
import { PET_SYSTEM, dueList, factSheet, recentlySaid, ruleAnswer } from "@/server/pet";
import { appendToChat, getChat } from "@/server/pet-chats";
import { isAddRequest, parseQuickAdd } from "@/server/quick-add";
import { createManualTask } from "@/server/tasks";
import { endOfSgtDay } from "@/lib/sgt";
import { dayLabel } from "@/lib/format-date";
import { retrieve } from "@/server/retrieve";
import { answerFromMaterial, isFollowUp, previousQuestion, type SourceRef } from "@/server/ask";

export const dynamic = "force-dynamic";

// Ask Papi something, inside a conversation. The conversation is stored, so
// its earlier turns give the model context and the student can come back to
// it. No sessionId starts a new one. With an AI provider the question is
// answered from a sheet of the student's own facts and the passages of their
// material that clear the relevance floor; without one, simple date
// questions still get an answer from the rules.
//
// Response: { reply, smart, sources, grounded, sessionId, title?, added? }.
// `sources` are the passages the reply cites ([n] in the text), each with a
// `label` ("slides", "study guide", "your note", "announcement").
// `grounded` is there only for an answer about course content: true when the
// reply cites at least one source, false when the model answered without one
// (the chat flags it). It is left out for replies that don't claim anything
// from the material: "I couldn't find that" (nothing passed the floor; the
// model was not asked), answers about dates and tasks from the student's
// facts, tasks added, and the rule-based replies. The same flag is kept on the
// stored message.
export async function POST(request: Request) {
  const userId = await currentUserId();
  if (userId === null) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    return NextResponse.json({ error: "expected a JSON body" }, { status: 415 });
  }
  if (!rateLimit(`pet:${userId}`, 40, 10 * 60_000)) return NextResponse.json({ reply: "I need a little breather — too many questions at once. Try again in a few minutes?" });
  let body: { message?: unknown; sessionId?: unknown; moduleId?: unknown };
  try { body = (await request.json()) as typeof body; } catch { return NextResponse.json({ error: "invalid body" }, { status: 400 }); }
  const question = typeof body.message === "string" ? body.message.trim().slice(0, 1000) : "";
  if (!question) return NextResponse.json({ error: "nothing to answer" }, { status: 400 });
  const sessionId = typeof body.sessionId === "number" && Number.isInteger(body.sessionId) ? body.sessionId : null;
  // Which module's material to search: the page the student is on, or all.
  const scope = typeof body.moduleId === "number" && Number.isInteger(body.moduleId) ? body.moduleId : null;

  const db = getDb();
  const now = Date.now();
  const env = loadEnv();
  const user = getUser(db, userId);
  const cfg = cfgForUser(db, userId, now);
  const mods = db.select().from(modules).where(and(eq(modules.userId, userId), eq(modules.active, true))).all();
  const codes = mods.map((m) => m.code);
  const earlierTurns = sessionId !== null ? (getChat(db, userId, sessionId)?.messages ?? []) : [];

  // "Remind me to …" becomes a task straight away, no model needed.
  if (isAddRequest(question)) {
    const q = parseQuickAdd(question, codes, now);
    const moduleId = q.moduleCode ? mods.find((m) => m.code === q.moduleCode)?.id ?? null : null;
    const dueAt = q.day ? endOfSgtDay(q.day) : null;
    const id = createManualTask(db, userId, { title: q.title, dueAt, moduleId }, now);
    const reply = id === null
      ? "What should I remind you about? Try “remind me to print the tutorial sheet by Friday”."
      : `Added to your tasks: “${q.title}”${dueAt ? `, due ${dayLabel(dueAt)}` : " (no date — say “by Friday” next time and I'll set one)"}. It's on the Tasks page.`;
    // The demo account is shared by every visitor: nobody's chat is kept for the next one.
    if (user?.isDemo) return NextResponse.json({ reply, smart: false, sessionId: null, added: id !== null });
    const saved = appendToChat(db, userId, earlierTurns.length ? sessionId : null, question, reply, now, []);
    return NextResponse.json({ reply, smart: false, sessionId: saved.id, title: saved.title, added: id !== null });
  }
  const fallback = () => ruleAnswer(question, dueList(db, userId, now), codes, now, recentlySaid(db, userId, now));
  const earlier = earlierTurns;

  let reply: string;
  let smart = false;
  let sources: SourceRef[] = [];
  let grounded: boolean | undefined;
  if (!cfg) reply = fallback();
  else {
    try {
      // The student's own material that bears on the question, numbered. A
      // short follow-up ("why?") is searched together with the question before it.
      const ownsScope = scope !== null && mods.some((m) => m.id === scope);
      const context = isFollowUp(question) ? previousQuestion(earlier) : null;
      const found = await retrieve(db, userId, question, { moduleId: ownsScope ? scope : null, cfg, k: 8, context }).catch(() => null);
      const out = await answerFromMaterial({
        question, earlier, context, hits: found?.hits ?? [], system: PET_SYSTEM, facts: factSheet(db, userId, now),
        llm: (messages, o) => complete(cfg, messages, { ...o, timeoutMs: 60_000 }),
      });
      reply = out.reply || fallback();
      sources = out.sources;
      grounded = out.reply ? out.grounded : undefined;
      smart = out.askedModel;
    } catch {
      // The model is down or out of credit: the rules still know the dates.
      reply = `${fallback()} (My big brain is offline, so that's the short version.)`;
    }
  }
  if (user?.isDemo) return NextResponse.json({ reply, smart, sources, grounded, sessionId: null });
  const saved = appendToChat(db, userId, earlier.length ? sessionId : null, question, reply, now, sources, grounded);
  return NextResponse.json({ reply, smart, sources, grounded, sessionId: saved.id, title: saved.title });
}
