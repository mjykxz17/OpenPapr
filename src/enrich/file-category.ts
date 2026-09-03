import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "../db/client";
import { files, FILE_CATEGORIES, type FileCategory } from "../db/schema";
import { setFileCategory } from "../db/repo";
import { chatJson, type CompatConfig } from "./openai-compat";

// What kind of material a course file is. Two stages, in the same shape as the
// deadline classifier: rules decide the obvious names for free, and only what
// they cannot decide goes to the model in one batched call per sync cycle,
// together with the announcement or page that linked the file — the clue that
// turns "intro.pdf" into a lecture deck.

export interface FileForCategory {
  displayName: string;
  contentType: string | null;
  linkedFrom?: string | null;
  linkContext?: string | null;
}

// Order matters: a name can match several. "Final Quiz Seating Plan" is admin
// before it is practice; "T11-Answers" is a tutorial before it is an answer
// key; "Feedback for Lecture Topic 5" is a feedback summary, not a deck.
const RULES: [FileCategory, RegExp][] = [
  ["admin", /(seating|survey|outline|indemnity|timetable|schedule|poster|\bedm\b|feedback|policy|consent|registration)/i],
  ["tutorial", /(tutorial|\btut\s?\d|walkthrough|\blab\s?\d|\blabs?\b|^T\d+[-_ ]|practical|worksheet)/i],
  ["practice", /(sample|practice|mock|past\s?(year|paper)|\bexam\b|\bexams\b|quiz|\btest\b|answer|solution|reference sheet|cheat ?sheet)/i],
  ["assignment", /(assignment|assgn|coursework|homework|\bhw\s?\d|project brief|\bproject\s?\d)/i],
  ["reading", /(\(mandatory\)|\(optional\)|\bchapter\b|\bch\.\s?\d|\bpp\.\s?\d|\breading|^[A-Z][\w.]+(?: [A-Z][\w.]+)+ - |- [A-Z][a-z]+ [A-Z][\w-]+\.\w+$|excerpt)/i],
  ["slides", /(\blec\s?\d|lect|lecture|slides?\b|^W\d+[-_ >]|\bweek\s?\d|^U\d+[-_]|\bunit\s?\d|prelim|^L\d+[-_ ])/i],
];

export function categorizeByRule(f: FileForCategory): FileCategory | null {
  if (f.contentType?.startsWith("image/")) return "image";
  for (const [category, re] of RULES) if (re.test(f.displayName)) return category;
  return null;
}

// --- model pass ---------------------------------------------------------

const Result = z.object({
  files: z.array(z.object({ id: z.number(), category: z.enum(FILE_CATEGORIES) })),
});

const SYSTEM = `You sort university course files into categories for a student. Categories: "slides" (lecture decks and lecture notes), "tutorial" (tutorial sheets, lab handouts, walkthroughs, practicals), "assignment" (assignment or project briefs and instructions), "reading" (textbook chapters, papers, articles to read), "practice" (sample or past quizzes, exams, practice questions, answer keys), "admin" (surveys, forms, seating plans, outlines, schedules, feedback summaries, posters, recruitment), "image" (pictures), "other". Each line gives the file name and type, and when known the title of the announcement or page that linked it and the sentence around the link — use that context, the name alone is often uninformative. Reply with ONLY a JSON object, no prose, no code fences: {"files": [{"id": number, "category": string}]}`;

export type FileCategorizer = (batch: (FileForCategory & { id: number })[]) => Promise<Map<number, FileCategory> | null>;

export function createCompatFileCategorizer(cfg: CompatConfig, fetchFn: typeof fetch = fetch): FileCategorizer {
  return async (batch) => {
    if (batch.length === 0) return new Map();
    try {
      const lines = batch.map((f) => {
        const parts = [`id=${f.id} name="${f.displayName}" type=${f.contentType ?? "?"}`];
        if (f.linkedFrom) parts.push(`linked from: "${f.linkedFrom}"`);
        if (f.linkContext) parts.push(`context: "${f.linkContext}"`);
        return parts.join(" | ");
      });
      const raw = await chatJson(cfg, fetchFn, SYSTEM, lines.join("\n"), 2048);
      const parsed = Result.safeParse(raw);
      if (!parsed.success) return null;
      const requested = new Set(batch.map((f) => f.id));
      const out = new Map<number, FileCategory>();
      for (const r of parsed.data.files) if (requested.has(r.id)) out.set(r.id, r.category);
      // Left out by the model → "other", stamped so it is not re-asked each
      // cycle. A manual fix is one click away; a permanent retry loop is not.
      for (const f of batch) if (!out.has(f.id)) out.set(f.id, "other");
      return out;
    } catch {
      return null;
    }
  };
}

// --- orchestration ------------------------------------------------------

const LLM_BATCH = 40;

// Categorises every file of a module that has no category yet. Rules first;
// the rest go to the model when one is configured. A failed model call leaves
// those rows null so the next cycle tries again.
export async function categorizeModuleFiles(db: Db, moduleId: number, llm: FileCategorizer | null): Promise<void> {
  const pending = db.select().from(files).where(and(eq(files.moduleId, moduleId), isNull(files.category))).all();
  const undecided: (FileForCategory & { id: number })[] = [];
  for (const f of pending) {
    const ruled = categorizeByRule(f);
    if (ruled) setFileCategory(db, f.id, ruled, "rule");
    else undecided.push({ id: f.id, displayName: f.displayName, contentType: f.contentType, linkedFrom: f.linkedFrom, linkContext: f.linkContext });
  }
  if (!llm || undecided.length === 0) return;
  const result = await llm(undecided.slice(0, LLM_BATCH));
  if (!result) return;
  for (const [id, category] of result) setFileCategory(db, id, category, "llm");
}
