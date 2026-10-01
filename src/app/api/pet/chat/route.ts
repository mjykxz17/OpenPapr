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
import { createManualTask, endOfSgtDay } from "@/server/tasks";
import { dayLabel } from "@/lib/format-date";
import { retrieve } from "@/server/retrieve";
import { SOURCES_RULES, citedSources, sourcesBlock, type SourceRef } from "@/server/ask";

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
    const saved = appendToChat(db, userId, earlierTurns.length ? sessionId : null, question, reply, now);
    return NextResponse.json({ reply, smart: false, sessionId: saved.id, title: saved.title, added: id !== null });
  }
  const fallback = () => ruleAnswer(question, dueList(db, userId, now), codes, now, recentlySaid(db, userId, now));
  const earlier = earlierTurns;

  let reply: string;
  let smart = false;
  let sources: SourceRef[] = [];
  if (!cfg) reply = fallback();
  else {
    try {
      // The student's own material that bears on the question, numbered.
      const ownsScope = scope !== null && mods.some((m) => m.id === scope);
      const found = await retrieve(db, userId, question, { moduleId: ownsScope ? scope : null, cfg, k: 8 }).catch(() => null);
      const hits = found?.hits ?? [];
      const system = hits.length
        ? `${PET_SYSTEM}\n\n${SOURCES_RULES}\n\nFACTS\n${factSheet(db, userId, now)}\n\nSOURCES\n${sourcesBlock(hits)}`
        : `${PET_SYSTEM}\n\nFACTS\n${factSheet(db, userId, now)}`;
      const out = await complete(cfg, [
        { role: "system", content: system },
        ...earlier.slice(-8).map((m) => ({ role: m.role, content: m.content })),
        { role: "user", content: question },
      ], { maxTokens: hits.length ? 700 : 400, temperature: hits.length ? 0.3 : 0.6, timeoutMs: 60_000 });
      const clean = out.replace(/<think>[\s\S]*?<\/think>/g, "").replace(/\*\*(.+?)\*\*/g, "$1").replace(/^#+\s*/gm, "").trim();
      const cited = citedSources(clean, hits);
      reply = cited.text || fallback();
      sources = cited.sources;
      smart = true;
    } catch {
      // The model is down or out of credit: the rules still know the dates.
      reply = `${fallback()} (My big brain is offline, so that's the short version.)`;
    }
  }
  if (user?.isDemo) return NextResponse.json({ reply, smart, sources, sessionId: null });
  const saved = appendToChat(db, userId, earlier.length ? sessionId : null, question, reply, now, sources);
  return NextResponse.json({ reply, smart, sources, sessionId: saved.id, title: saved.title });
}
