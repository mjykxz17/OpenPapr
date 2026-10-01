import { z } from "zod";
import { chatJson, type CompatConfig } from "./openai-compat";

// The automatic guide is organised by topic, not by file. One cheap model
// call per module sorts the lecture decks (newest copy of each) into topics in
// teaching order, names them by what they teach, and says which practice
// sheets, quizzes, assignments and lecturer notes belong to each. The
// expensive writing happens per topic, later, and only when its slides change.

export type PlanRef = { ref: string; line: string };
export type PlanInput = {
  module: string;                // "CS4239 Software Security"
  lectures: PlanRef[];           // L1… : deck name, slide count, opening text
  practice: PlanRef[];           // P1… : tutorial and lab sheets
  assessments: PlanRef[];        // A1… : quizzes and assignments with dates
  notes: PlanRef[];              // N1… : announcements and staff replies
  existing: { key: string; title: string; lectures: string[] }[];
};

export const PLAN_SYSTEM = `You organise a university module's lecture slides into the chapters of a study guide.

You get the module, its lecture decks (L refs: file name, slide count, opening text), practice sheets (P refs), quizzes and assignments (A refs) and lecturer notes (N refs), and the chapters already in use.

Return ONLY a JSON object, no prose, no code fences:
{"title": "<a name for the whole guide, by what the module teaches, under 70 characters, not the module code>",
 "topics": [{"key": "<short-kebab-slug>", "title": "<chapter title, by what it teaches, under 60 characters>",
             "lectures": ["L1"], "practice": ["P2"], "assessments": ["A1"], "notes": ["N3"]}]}

Rules:
- Every L ref appears in exactly one topic. Topics follow teaching order (week, unit or lecture number).
- One topic per lecture, unless decks are clearly parts of ONE lecture (e.g. "Lec01A" and "Lec01B", "intro1" and "intro2", "part1/part2/part3" of one subject) — then put them together.
- Titles say what is taught ("Memory errors: overflows and use-after-free"), never the file name ("U3-memerr1").
- Keep the key of an existing chapter when it covers the same lectures, so it is not rewritten for nothing.
- practice: a sheet belongs to the topic whose content it exercises. Leave it out if unsure.
- assessments: link a quiz or assignment only when its title, an announcement or the slides say it covers this topic. Leave it out if unsure. One assessment may cover several topics.
- notes: only notes that change what or how to study this topic (scope of a quiz, a correction, "this will be examined", "skip slides 30-40"). Not logistics.
- Never invent refs.`;

const Plan = z.object({
  title: z.string().optional().default(""),
  topics: z.array(z.object({
    key: z.string().optional().default(""),
    title: z.string(),
    lectures: z.array(z.string()).default([]),
    practice: z.array(z.string()).default([]),
    assessments: z.array(z.string()).default([]),
    notes: z.array(z.string()).default([]),
  })).default([]),
});

export type PlannedTopic = { key: string; title: string; lectures: string[]; practice: string[]; assessments: string[]; notes: string[] };
export type GuidePlan = { title: string | null; topics: PlannedTopic[] };

export function planPrompt(input: PlanInput): string {
  const block = (name: string, rows: PlanRef[]) => `=== ${name} ===\n${rows.length ? rows.map((r) => `${r.ref}: ${r.line}`).join("\n") : "(none)"}`;
  return [
    `Module: ${input.module}`,
    block("LECTURE DECKS", input.lectures),
    block("PRACTICE SHEETS", input.practice),
    block("QUIZZES AND ASSIGNMENTS", input.assessments),
    block("LECTURER NOTES", input.notes),
    `=== CHAPTERS IN USE ===\n${input.existing.length ? input.existing.map((e) => `${e.key}: ${e.title} [${e.lectures.join(", ")}]`).join("\n") : "(none)"}`,
  ].join("\n\n");
}

export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "topic";

const clipTitle = (s: string, n: number) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length <= n ? t : `${t.slice(0, n - 1).replace(/\s+\S*$/, "")}…`;
};

// Whatever the model returned, a usable plan: known refs only, every lecture
// in exactly one topic (strays get a topic of their own), unique keys.
export function cleanPlan(raw: unknown, input: PlanInput, fallbackTitle: (lectureRef: string) => string): GuidePlan {
  const known = (rows: PlanRef[]) => new Set(rows.map((r) => r.ref));
  const L = known(input.lectures), P = known(input.practice), A = known(input.assessments), N = known(input.notes);
  const parsed = Plan.safeParse(raw);
  const used = new Set<string>();
  const keys = new Set<string>();
  const topics: PlannedTopic[] = [];
  const unique = (base: string) => { let k = slug(base), n = 2; while (keys.has(k)) k = `${slug(base)}-${n++}`; keys.add(k); return k; };

  for (const t of parsed.success ? parsed.data.topics : []) {
    const lectures = [...new Set(t.lectures)].filter((r) => L.has(r) && !used.has(r));
    if (!lectures.length || !t.title.trim()) continue;
    lectures.forEach((r) => used.add(r));
    topics.push({
      key: unique(t.key || t.title), title: clipTitle(t.title, 60), lectures,
      practice: [...new Set(t.practice)].filter((r) => P.has(r)),
      assessments: [...new Set(t.assessments)].filter((r) => A.has(r)),
      notes: [...new Set(t.notes)].filter((r) => N.has(r)),
    });
  }
  for (const l of input.lectures) {
    if (used.has(l.ref)) continue;
    const title = fallbackTitle(l.ref);
    topics.push({ key: unique(title), title: clipTitle(title, 60), lectures: [l.ref], practice: [], assessments: [], notes: [] });
  }
  const title = parsed.success && parsed.data.title.trim() ? clipTitle(parsed.data.title, 70) : null;
  return { title, topics };
}

export async function planGuide(cfg: CompatConfig, input: PlanInput, fallbackTitle: (lectureRef: string) => string, fetchFn: typeof fetch = fetch): Promise<GuidePlan> {
  let raw = await chatJson(cfg, fetchFn, PLAN_SYSTEM, planPrompt(input), 4000);
  if (!Plan.safeParse(raw).success || !(raw as { topics?: unknown[] })?.topics?.length) {
    raw = await chatJson(cfg, fetchFn, PLAN_SYSTEM, planPrompt(input), 4000);
  }
  if (!Plan.safeParse(raw).success) throw new Error("the model did not return a usable plan");
  return cleanPlan(raw, input, fallbackTitle);
}
