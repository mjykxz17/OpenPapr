import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/client";
import { guideQuizzes, modules } from "@/db/schema";
import { getStudyGuide } from "@/db/repo";
import { splitGuideIntoChapters } from "@/lib/study-chapters";
import { parseSlideCitation } from "@/lib/slide-citation";
import { chatJson, type CompatConfig } from "@/enrich/openai-compat";

// Practice questions for one chapter of the guide: multiple choice, each with
// the reason and the slide it comes from. Made once per version of the
// chapter and kept, so asking again costs nothing.

export type QuizQuestion = { q: string; options: string[]; answer: number; why: string; slide: { deck: string; page: number } | null };

const RawQ = z.object({
  q: z.string().trim().min(8),
  options: z.array(z.coerce.string().trim().min(1)).length(4),
  answer: z.coerce.number().int().min(0).max(3),
  why: z.string().trim().default(""),
  slide: z.string().trim().nullable().optional(),
});
const Raw = z.object({ questions: z.array(z.unknown()).max(12) });

export const QUIZ_SYSTEM = `You write practice questions for a university student from one chapter of their study guide.

Write 6 multiple-choice questions that test understanding, not trivia: apply a concept, compare two ideas, spot the mistake, predict what happens. Mix easy and hard. Use ONLY what the chapter says; never bring in outside facts.
Each question has exactly 4 options, one clearly correct. Wrong options must be plausible mistakes a student would make. Do not use "all of the above" or "none of the above". Vary the position of the correct answer.
"why": one or two sentences explaining the right answer.
"slide": the chapter cites slides as links like (slide:DECK#PAGE). Copy the one this question comes from, exactly, e.g. "slide:L3-buffer#14". null if none fits.

Return ONLY JSON: {"questions": [{"q": "", "options": ["", "", "", ""], "answer": 0, "why": "", "slide": "slide:DECK#PAGE"}]}
No emoji.`;

export const chapterHash = (markdown: string) => createHash("sha256").update(markdown).digest("hex").slice(0, 32);

export function cleanQuiz(raw: unknown, chapter: string): QuizQuestion[] {
  const parsed = Raw.safeParse(raw);
  if (!parsed.success) return [];
  const out: QuizQuestion[] = [];
  for (const one of parsed.data.questions) {
    const p = RawQ.safeParse(one);
    if (!p.success) continue;
    const x = p.data;
    if (new Set(x.options.map((o) => o.toLowerCase())).size < 4) continue;
    // Only a slide the chapter really cites.
    const ref = x.slide && chapter.includes(`(${x.slide})`) ? parseSlideCitation(x.slide) : null;
    out.push({ q: x.q, options: x.options, answer: x.answer, why: x.why, slide: ref });
  }
  return out.slice(0, 8);
}

export type QuizResult = { questions: QuizQuestion[]; cached: boolean } | { error: string; status: number };

export async function chapterQuiz(
  db: Db, userId: number, moduleId: number, chapterIndex: number, cfg: CompatConfig | null, now: number,
  opts: { fresh?: boolean; fetchFn?: typeof fetch } = {},
): Promise<QuizResult> {
  const mod = db.select().from(modules).where(and(eq(modules.id, moduleId), eq(modules.userId, userId))).get();
  if (!mod) return { error: "Module not found", status: 404 };
  const guide = getStudyGuide(db, moduleId);
  const chapter = guide ? splitGuideIntoChapters(guide.markdown).chapters[chapterIndex] : undefined;
  if (!chapter) return { error: "That chapter isn't in the guide any more — reload the page.", status: 404 };
  const h = chapterHash(chapter.markdown);
  const cached = db.select().from(guideQuizzes).where(and(eq(guideQuizzes.moduleId, moduleId), eq(guideQuizzes.chapterHash, h))).get();
  if (cached && !opts.fresh) {
    try { return { questions: JSON.parse(cached.questionsJson) as QuizQuestion[], cached: true }; } catch { /* make a new one */ }
  }
  if (!cfg) return { error: "Practice questions need an AI model — add a key in Account, or the shared one has run out this month.", status: 402 };
  let raw: unknown;
  try {
    raw = await chatJson(cfg, opts.fetchFn ?? fetch, QUIZ_SYSTEM, `Module: ${mod.code} ${mod.name}\n\nCHAPTER\n${chapter.markdown.slice(0, 16_000)}`, 4000, 120_000);
  } catch {
    return { error: "The AI model didn't answer. Try again in a minute.", status: 502 };
  }
  const questions = cleanQuiz(raw, chapter.markdown);
  if (questions.length < 3) return { error: "The questions came back garbled. Try again.", status: 502 };
  db.insert(guideQuizzes).values({ moduleId, chapterHash: h, questionsJson: JSON.stringify(questions), createdAt: now })
    .onConflictDoUpdate({ target: [guideQuizzes.moduleId, guideQuizzes.chapterHash], set: { questionsJson: JSON.stringify(questions), createdAt: now } }).run();
  return { questions, cached: false };
}
