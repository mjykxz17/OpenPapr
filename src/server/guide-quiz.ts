import { createHash } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/client";
import { guideQuizzes, modules, quizAttempts } from "@/db/schema";
import { getStudyGuide, listModuleFiles } from "@/db/repo";
import { splitGuideIntoChapters, type GuideChapter } from "@/lib/study-chapters";
import { citedPagesByDeck, parseSlideCitation } from "@/lib/slide-citation";
import { chapterHash } from "@/lib/guide-chapters";
import { chatJson, isNoAnswer, isOutOfBudget, type CompatConfig } from "@/enrich/openai-compat";
import { deckStem } from "./deck";

// Practice questions for one chapter of the guide: multiple choice, each with
// the reason and the slide it comes from. Made once per version of the
// chapter and kept, so asking again costs nothing. Each answer the student
// gives is kept too, with the slide its question came from, so a reload shows
// where they were and the planner can see which slides they keep missing.

// `missedBefore`: carried over from the previous set because the student got
// it wrong there, so the quiz can say "Missed last time" before it is answered.
export type QuizQuestion = { q: string; options: string[]; answer: number; why: string; slide: { deck: string; page: number } | null; missedBefore?: true };
export type QuizAnswer = { question: number; chosen: number; correct: boolean; answeredAt: number };

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
"answer": the index (0-3) of the correct option. Check it against the chapter before you write it.
"why": one or two sentences explaining the right answer.
"slide": the chapter cites slides as links like (slide:DECK#PAGE). Copy the one this question comes from, exactly, e.g. "slide:L3-buffer#14". null if none fits.

Return ONLY JSON: {"questions": [{"q": "", "options": ["", "", "", ""], "answer": 0, "why": "", "slide": "slide:DECK#PAGE"}]}
No emoji.`;

// Keyed on the chapter's slide-written body, not the assembled chapter; see
// guide-chapters.ts.
export { chapterHash };
// Which set of questions an answer belongs to. "New questions" makes a new
// set, so the old answers stop showing but still count as weak spots. This is
// what quiz_attempts.chapter_hash holds.
export const quizSetKey = (questionsJson: string) => createHash("sha256").update(`set:${questionsJson}`).digest("hex").slice(0, 32);

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").replace(/[.!]+$/, "").trim();
const CATCH_ALL = /^(all|none|both|neither) of (the )?(above|these|them|others)$/;

// Page counts of the module's decks, by lower-case deck name; null when the
// deck's text was never read.
export type DeckPages = Map<string, number | null>;
export function deckPagesFor(db: Db, moduleId: number): DeckPages {
  const out: DeckPages = new Map();
  for (const f of listModuleFiles(db, moduleId)) {
    let pages: number | null = null;
    try { pages = f.textSigJson ? Number((JSON.parse(f.textSigJson) as { pages?: number }).pages) || null : null; } catch { /* unknown */ }
    out.set(deckStem(f.displayName).toLowerCase(), pages);
  }
  return out;
}

// Keeps the questions that hold up: four different, non-empty options, no
// catch-all option, an answer index that points at one of them, and a slide
// that is really in this chapter's decks (one the chapter cites, or a page
// the deck has). A question citing any other slide is dropped: it was made up.
export function cleanQuiz(raw: unknown, chapter: string, decks: DeckPages = new Map()): QuizQuestion[] {
  const parsed = Raw.safeParse(raw);
  if (!parsed.success) return [];
  const cited = new Map(Object.entries(citedPagesByDeck(chapter)).map(([d, pages]) => [d.toLowerCase(), { deck: d, pages }]));
  const out: QuizQuestion[] = [];
  const asked = new Set<string>();
  for (const one of parsed.data.questions) {
    const p = RawQ.safeParse(one);
    if (!p.success) continue;
    const x = p.data;
    if (x.answer >= x.options.length) continue;
    const opts = x.options.map(norm);
    if (new Set(opts).size < 4 || opts.some((o) => !o || CATCH_ALL.test(o))) continue;
    if (asked.has(norm(x.q))) continue;
    let slide: QuizQuestion["slide"] = null;
    const ref = x.slide ? parseSlideCitation(x.slide.replace(/^\(|\)$/g, "")) : null;
    if (ref) {
      const inChapter = cited.get(ref.deck.toLowerCase());
      const pages = decks.get(ref.deck.toLowerCase());
      const exists = !!inChapter && (inChapter.pages.includes(ref.page) || (typeof pages === "number" && ref.page >= 1 && ref.page <= pages));
      if (!exists) continue;
      slide = { deck: inChapter!.deck, page: ref.page };
    }
    asked.add(norm(x.q));
    out.push({ q: x.q, options: x.options, answer: x.answer, why: x.why, slide });
  }
  return out.slice(0, 8);
}

// The chapter as the model sees it. A long chapter is not cut off at the
// end: every section keeps a fair share of the room, so questions can come
// from all of it.
export const QUIZ_BUDGET = 24_000;
export function quizSource(markdown: string, budget = QUIZ_BUDGET): string {
  if (markdown.length <= budget) return markdown;
  const parts = markdown.split(/\n(?=### )/);
  const room = new Array<number>(parts.length);
  let left = budget;
  // Short sections keep all of theirs; the long ones share what is left.
  const bySize = parts.map((p, i) => ({ i, n: p.length })).sort((a, b) => a.n - b.n);
  bySize.forEach(({ i, n }, k) => {
    room[i] = Math.min(n, Math.floor(left / (bySize.length - k)));
    left -= room[i]!;
  });
  return parts.map((p, i) => (p.length > room[i]! ? `${p.slice(0, Math.max(0, room[i]! - 1))}…` : p)).join("\n");
}

const MIN_QUESTIONS = 3;
const WANT_QUESTIONS = 4;   // fewer good ones than this and it asks once more
const MAX_CARRIED = 4;      // missed questions kept when a new set is made

type Found = { mod: typeof modules.$inferSelect; chapter: GuideChapter; hash: string } | { error: string; status: number };
function findChapter(db: Db, userId: number, moduleId: number, chapterIndex: number): Found {
  const mod = db.select().from(modules).where(and(eq(modules.id, moduleId), eq(modules.userId, userId))).get();
  if (!mod) return { error: "Module not found", status: 404 };
  const guide = getStudyGuide(db, moduleId);
  const chapter = guide ? splitGuideIntoChapters(guide.markdown).chapters[chapterIndex] : undefined;
  if (!chapter) return { error: "That chapter isn't in the guide any more — reload the page.", status: 404 };
  return { mod, chapter, hash: chapterHash(chapter.markdown) };
}

const topicTitleOf = (chapter: GuideChapter) => chapter.label.replace(/^\d+\.\s*/, "");

function answersFor(db: Db, userId: number, moduleId: number, set: string): QuizAnswer[] {
  return db.select().from(quizAttempts)
    .where(and(eq(quizAttempts.userId, userId), eq(quizAttempts.moduleId, moduleId), eq(quizAttempts.chapterHash, set))).all()
    .map((r) => ({ question: r.question, chosen: r.chosen, correct: r.correct, answeredAt: r.answeredAt }))
    .sort((a, b) => a.question - b.question);
}

type Saved = { questions: QuizQuestion[]; set: string };
function savedSet(db: Db, moduleId: number, hash: string): Saved | null {
  const row = db.select().from(guideQuizzes).where(and(eq(guideQuizzes.moduleId, moduleId), eq(guideQuizzes.chapterHash, hash))).get();
  if (!row) return null;
  try { return { questions: JSON.parse(row.questionsJson) as QuizQuestion[], set: quizSetKey(row.questionsJson) }; } catch { return null; }
}

export type QuizResult = { questions: QuizQuestion[]; cached: boolean; set: string; answers: QuizAnswer[] } | { error: string; status: number };

// The chapter's saved questions and this student's answers to them, without
// making any: null when none have been made yet.
export function savedQuiz(db: Db, userId: number, moduleId: number, chapterIndex: number): QuizResult | null {
  const found = findChapter(db, userId, moduleId, chapterIndex);
  if ("error" in found) return found;
  const saved = savedSet(db, moduleId, found.hash);
  return saved ? { ...saved, cached: true, answers: answersFor(db, userId, moduleId, saved.set) } : null;
}

export async function chapterQuiz(
  db: Db, userId: number, moduleId: number, chapterIndex: number, cfg: CompatConfig | null, now: number,
  opts: { fresh?: boolean; fetchFn?: typeof fetch } = {},
): Promise<QuizResult> {
  const found = findChapter(db, userId, moduleId, chapterIndex);
  if ("error" in found) return found;
  const { mod, chapter, hash: h } = found;
  const saved = savedSet(db, moduleId, h);
  if (saved && !opts.fresh) return { ...saved, cached: true, answers: answersFor(db, userId, moduleId, saved.set) };
  if (!cfg) return { error: "Practice questions need an AI model — add a key in Account, or the shared one has run out this month.", status: 402 };
  const decks = deckPagesFor(db, moduleId);
  const prompt = `Module: ${mod.code} ${mod.name}\n\nCHAPTER\n${quizSource(chapter.markdown)}`;
  let questions: QuizQuestion[] = [];
  // A first reply that was empty or cut off gets the second round, with
  // twice the budget (and time) when the reasoning spent the first.
  let budget = 4000;
  for (let round = 0; round < 2 && questions.length < WANT_QUESTIONS; round++) {
    let raw: unknown;
    try {
      raw = await chatJson(cfg, opts.fetchFn ?? fetch, QUIZ_SYSTEM, prompt, budget, budget * 30);
    } catch (err) {
      if (round > 0) {
        if (!questions.length) return { error: "The AI model didn't answer. Try again in a minute.", status: 502 };
        break;
      }
      if (!isNoAnswer(err)) return { error: "The AI model didn't answer. Try again in a minute.", status: 502 };
      if (isOutOfBudget(err)) budget *= 2;
      raw = null;
    }
    const seen = new Set(questions.map((q) => norm(q.q)));
    questions = [...questions, ...cleanQuiz(raw, chapter.markdown, decks).filter((q) => !seen.has(norm(q.q)))].slice(0, 8);
  }
  if (questions.length < MIN_QUESTIONS) return { error: "The questions came back garbled. Try again.", status: 502 };
  // "New questions" keeps the ones the student got wrong in the old set, at
  // the top, so missing a question once is not forgotten by asking for more.
  if (saved) {
    const wrong = new Set(answersFor(db, userId, moduleId, saved.set).filter((a) => !a.correct).map((a) => a.question));
    const carried = saved.questions.filter((_, i) => wrong.has(i)).slice(0, MAX_CARRIED)
      .map(({ missedBefore: _, ...q }) => ({ ...q, missedBefore: true as const }));
    const again = new Set(carried.map((q) => norm(q.q)));
    questions = [...carried, ...questions.filter((q) => !again.has(norm(q.q)))].slice(0, 8);
  }
  const json = JSON.stringify(questions);
  db.insert(guideQuizzes).values({ moduleId, chapterHash: h, questionsJson: json, createdAt: now })
    .onConflictDoUpdate({ target: [guideQuizzes.moduleId, guideQuizzes.chapterHash], set: { questionsJson: json, createdAt: now } }).run();
  const set = quizSetKey(json);
  return { questions, cached: false, set, answers: answersFor(db, userId, moduleId, set) };
}

// Takes back answers: "Start over" (all of this set's) or "Try the ones I
// missed again" (those questions), so a reload shows the quiz as the student
// left it rather than bring the old answers back. Answers to an older set of
// the chapter are left alone; nothing shows them.
export function clearAnswers(
  db: Db, userId: number, moduleId: number, a: { chapter: number; set: string; questions?: number[] },
): { cleared: number } | { error: string; status: number } {
  const found = findChapter(db, userId, moduleId, a.chapter);
  if ("error" in found) return found;
  const saved = savedSet(db, moduleId, found.hash);
  if (!saved || saved.set !== a.set) return { error: "These questions have changed — reload the page.", status: 409 };
  const mine = and(eq(quizAttempts.userId, userId), eq(quizAttempts.moduleId, moduleId), eq(quizAttempts.chapterHash, a.set));
  const where = a.questions ? and(mine, inArray(quizAttempts.question, a.questions)) : mine;
  return { cleared: db.delete(quizAttempts).where(where).run().changes };
}

export type AnswerResult = { correct: boolean; answer: number } | { error: string; status: number };

// Keeps one answer. Right or wrong is decided here from the saved question,
// never taken from the browser, and the question's slide goes with it.
export function recordAnswer(
  db: Db, userId: number, moduleId: number,
  a: { chapter: number; set: string; question: number; chosen: number }, now: number,
): AnswerResult {
  const found = findChapter(db, userId, moduleId, a.chapter);
  if ("error" in found) return found;
  const saved = savedSet(db, moduleId, found.hash);
  if (!saved || saved.set !== a.set) return { error: "These questions have changed — reload the page.", status: 409 };
  const q = saved.questions[a.question];
  if (!q || !Number.isInteger(a.chosen) || a.chosen < 0 || a.chosen >= q.options.length) return { error: "No such answer.", status: 400 };
  const correct = a.chosen === q.answer;
  const row = { chosen: a.chosen, correct, deck: q.slide?.deck ?? null, page: q.slide?.page ?? null, topicTitle: topicTitleOf(found.chapter), answeredAt: now };
  db.insert(quizAttempts).values({ userId, moduleId, chapterHash: a.set, question: a.question, ...row })
    .onConflictDoUpdate({ target: [quizAttempts.userId, quizAttempts.moduleId, quizAttempts.chapterHash, quizAttempts.question], set: row }).run();
  return { correct, answer: q.answer };
}
