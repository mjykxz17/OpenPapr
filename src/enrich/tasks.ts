import { createHash } from "node:crypto";
import { z } from "zod";
import { chatJson, type CompatConfig } from "./openai-compat";
import { TASK_KINDS } from "../db/schema";

// The task planner. Obligations reach a student from many places — a Canvas
// quiz, the announcement about that quiz, a slide that says "Tutorial 4 due
// before Week 6", a syllabus weighting a midterm at 30% — and the same one is
// often in several of them. The planner reads everything known about one
// module, returns each obligation once with every place it was seen, adds
// what is predictably coming (the next weekly tutorial, prep for a dated
// exam), and breaks each into small steps with a day to do each by.
//
// Everything here is pure: the worker gathers the inputs and writes results.

export type TaskKind = (typeof TASK_KINDS)[number];
export type TaskSource = {
  kind: "canvas" | "announcement" | "file" | "weightage" | "nusmods";
  label: string;
  itemId?: number;
  fileId?: number;
  page?: number;
  quote?: string;
};
export type TaskStep = { id: string; text: string; minutes: number; doBy: string; done: boolean };

// --- inputs ------------------------------------------------------------------
export type SignalItem = { ref: string; line: string; body?: string };
export type ModuleTaskInput = {
  today: string;                 // "2026-09-25 (Fri)" in Asia/Singapore
  module: { code: string; name: string };
  canvas: SignalItem[];          // open assignments, quizzes, dated events, extracted deadlines
  past: SignalItem[];            // recent past/submitted work, for spotting a weekly pattern
  announcements: SignalItem[];
  fileHints: SignalItem[];       // obligation-looking lines from slides and handouts
  weightage: { name: string; weightPct: number }[];
  examDate: string | null;       // NUSMods final exam date for this semester
  studyAdvice: string[];         // from the module profile: how to study, gaps
  existing: { key: string; title: string; due: string | null; progress: string }[];
};

// --- output ------------------------------------------------------------------
const str = z.string().trim();
const optStr = z.union([str, z.null()]).optional().transform((v) => (v ? v : null));
const PlannedTask = z.object({
  key: str.min(3),
  title: str.min(2),
  kind: z.string().transform((k) => ((TASK_KINDS as readonly string[]).includes(k) ? (k as TaskKind) : "prep")),
  due: optStr,
  dueConfidence: z.enum(["exact", "estimated"]).catch("estimated"),
  anticipated: z.coerce.boolean().catch(false),
  weightPct: z.union([z.coerce.number(), z.null()]).optional().catch(null).transform((v) => (typeof v === "number" && v > 0 && v <= 100 ? v : null)),
  why: optStr,
  sources: z.array(z.object({ ref: str, quote: optStr })).max(8).default([]),
  steps: z.array(z.object({ text: str.min(2), minutes: z.coerce.number().catch(30), doBy: optStr })).max(10).default([]),
});
const PlanResult = z.object({ tasks: z.array(z.unknown()).max(30).default([]) });
export type PlannedTask = z.infer<typeof PlannedTask>;

export const PLANNER_SYSTEM = `You are the planner in a study app for an NUS student. For ONE module you get today's date and every signal we have: open Canvas assignments/quizzes/deadlines, recent past work, announcements, obligation-looking lines from the slides and handouts, the assessment weightage, the final exam date, study advice, and the tasks already planned.

Find every obligation for this module and anticipate what is coming, then break each into small executable steps.

Rules:
- ONE task per obligation. A quiz that is a Canvas item AND mentioned in an announcement AND on a slide is one task citing all three refs.
- Include graded work, quizzes, tests, exams, submissions, presentations, project milestones, prep the sources explicitly ask for (readings, pre-lecture work), and admin with a consequence (registration, forms, bidding).
- Skip attending lectures, labs or tutorials, bringing or charging a laptop, anything already submitted or past, and generic advice with no source.
- Anticipate only when grounded in a source you cite (anticipated=true, dueConfidence="estimated"): the next instance of a clear weekly pattern, preparation for a dated or week-numbered assessment, a milestone the schedule implies, revision for the final exam. Never invent an assessment. The weightage alone tells you an assessment exists, never its date: without a dated or week-numbered source, set due to null.
- Horizon: things due in the next 6 weeks, plus the final exam.
- due: ISO 8601 with +08:00. "exact" only when a source states the date; a week number or pattern gives an "estimated" date; null if you cannot place it.
- Different dates for different tutorial or lab groups: you do not know the student's group, so make ONE task with the earliest date and name the other date in "why".
- steps: every task needs 1-6 steps (only a task resting on the weightage alone may have none), each 15-90 minutes, verb first, under 70 characters, specific to this module's material (name the lecture, chapter, question range or topic). A form or registration is one step. Each step has doBy (YYYY-MM-DD) between today and the due date, spread out and finishing a day early where possible. For anticipated tasks more than two weeks away give only the first one or two steps.
- key: lowercase slug starting with the module code, e.g. "cs2103t-v1-2-milestone". Reuse the key of an existing task when it is the same obligation.
- why: under 90 characters — the weight, what it covers, or what the source says.
- sources: refs exactly as given (e.g. "C12", "A40", "F7p3", "W", "X"), each with the key phrase quoted (under 120 characters).

Return ONLY a JSON object: {"tasks": [{"key": "", "title": "<under 60 characters>", "kind": "exam|quiz|submission|project|presentation|prep|reading|admin", "due": "<ISO or null>", "dueConfidence": "exact|estimated", "anticipated": false, "weightPct": <number or null>, "why": "", "sources": [{"ref": "", "quote": ""}], "steps": [{"text": "", "minutes": 30, "doBy": "YYYY-MM-DD"}]}]}
No emoji.`;

export function plannerPrompt(input: ModuleTaskInput): string {
  const block = (title: string, rows: SignalItem[]) =>
    `${title}:\n${rows.length ? rows.map((r) => `[${r.ref}] ${r.line}${r.body ? `\n    ${r.body}` : ""}`).join("\n") : "(none)"}`;
  return [
    `Today: ${input.today}`,
    `Module: ${input.module.code} ${input.module.name}`,
    block("Open Canvas work", input.canvas),
    block("Recent past work (for patterns)", input.past),
    block("Announcements", input.announcements),
    block("From the slides and handouts", input.fileHints),
    `[W] Weightage: ${input.weightage.length ? input.weightage.map((c) => `${c.name} ${c.weightPct}%`).join(", ") : "(unknown)"}`,
    `[X] Final exam: ${input.examDate ?? "(no date on NUSMods)"}`,
    `Study advice: ${input.studyAdvice.join("; ") || "(none)"}`,
    `Already planned:\n${input.existing.map((e) => `- ${e.key}: ${e.title} (due ${e.due ?? "?"}, ${e.progress})`).join("\n") || "(none)"}`,
  ].join("\n\n");
}

// --- validation --------------------------------------------------------------
export type CleanTask = {
  key: string; title: string; kind: TaskKind; dueAt: number | null; dueConfidence: "exact" | "estimated";
  anticipated: boolean; weightPct: number | null; why: string | null; sources: TaskSource[]; steps: TaskStep[];
};

export const sgtDate = (ms: number) => new Date(ms + 8 * 3_600_000).toISOString().slice(0, 10);
const addDays = (date: string, n: number) => sgtDate(Date.parse(`${date}T12:00:00+08:00`) + n * 86_400_000);
export const stepId = (key: string, text: string) => createHash("sha1").update(`${key}\n${text}`).digest("hex").slice(0, 10);
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const ROUTINE_RE = /^(attend|bring|charge|go to|join|be present)\b/i;
const slugKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);

// Turns the model's answer into tasks we can trust: every task must cite at
// least one real signal, dates must parse, past work is dropped, steps land
// between today and the due date.
export function cleanPlan(raw: unknown, refs: Map<string, TaskSource>, now: number, moduleCode: string): CleanTask[] | null {
  const top = PlanResult.safeParse(raw);
  if (!top.success) return null;
  const today = sgtDate(now);
  const out: CleanTask[] = [];
  const seen = new Set<string>();
  let weightOnlyCount = 0;
  for (const r of top.data.tasks) {
    const p = PlannedTask.safeParse(r);
    if (!p.success) continue;
    const t = p.data;
    const sources: TaskSource[] = [];
    for (const s of t.sources) {
      const base = refs.get(s.ref.replace(/[[\]\s]/g, ""));
      if (!base || sources.some((x) => x.label === base.label)) continue;
      sources.push(s.quote ? { ...base, quote: clip(s.quote, 160) } : base);
    }
    if (!sources.length) continue;                       // not grounded in anything we gave it
    // Showing up is not a task, whatever the model thinks.
    if (ROUTINE_RE.test(t.title) && !["exam", "quiz", "presentation"].includes(t.kind)) continue;
    // A weighting says an assessment exists, never when: a task resting on
    // the weightage alone gets no date and only its first step.
    const weightOnly = sources.every((x) => x.kind === "weightage");
    if (weightOnly && ++weightOnlyCount > 2) continue;
    let key = slugKey(t.key);
    if (!key.startsWith(moduleCode.toLowerCase())) key = slugKey(`${moduleCode}-${key}`);
    if (seen.has(key)) continue;
    seen.add(key);
    const parsed = t.due && !weightOnly ? Date.parse(t.due) : NaN;
    const dueAt = Number.isNaN(parsed) ? null : parsed;
    if (dueAt !== null && dueAt < now - 12 * 3_600_000) continue;   // already past
    if (dueAt !== null && dueAt > now + 200 * 86_400_000) continue; // not this semester
    const lastDay = dueAt === null ? addDays(today, 42) : sgtDate(dueAt);
    const steps: TaskStep[] = [];
    for (const s of t.steps) {
      const text = clip(s.text, 90);
      const id = stepId(key, text);
      if (steps.some((x) => x.id === id)) continue;
      let doBy = s.doBy && /^\d{4}-\d{2}-\d{2}$/.test(s.doBy) ? s.doBy : today;
      if (doBy < today) doBy = today;
      if (doBy > lastDay) doBy = lastDay;
      steps.push({ id, text, minutes: Math.round(Math.min(180, Math.max(5, s.minutes))), doBy, done: false });
    }
    steps.sort((a, b) => a.doBy.localeCompare(b.doBy));
    if (weightOnly) steps.splice(1);
    out.push({
      key, title: clip(t.title, 80), kind: t.kind, dueAt,
      dueConfidence: dueAt === null ? "estimated" : t.dueConfidence,
      anticipated: t.anticipated || weightOnly, weightPct: t.weightPct, why: t.why ? clip(t.why, 120) : null, sources, steps,
    });
  }
  return out;
}

export async function planModuleTasks(
  cfg: CompatConfig, input: ModuleTaskInput, refs: Map<string, TaskSource>, now: number, fetchFn: typeof fetch = fetch,
): Promise<CleanTask[]> {
  // Some models now and then answer with nothing, or cut the JSON short;
  // one more try usually lands.
  let tasks: CleanTask[] | null = null;
  for (let attempt = 0; attempt < 2 && tasks === null; attempt++) {
    tasks = cleanPlan(await chatJson(cfg, fetchFn, PLANNER_SYSTEM, plannerPrompt(input), 6000), refs, now, input.module.code);
  }
  if (!tasks) throw new Error("the model's task plan was not in the expected shape");
  return tasks;
}

// --- merging into what the student already has -------------------------------
export type ExistingTask = {
  id: number; key: string; status: "open" | "done" | "dismissed"; touchedAt: number | null; steps: TaskStep[];
};
export type MergeOps = {
  insert: CleanTask[];
  update: { id: number; task: CleanTask; keepSteps: boolean }[];
  remove: number[];
};

// A rebuild never throws away the student's progress: a task they have
// touched keeps its steps (only its date and sources refresh), a task they
// finished or dismissed stays that way, and only untouched tasks the planner
// no longer sees are removed.
export function mergeTasks(existing: ExistingTask[], planned: CleanTask[]): MergeOps {
  const byKey = new Map(existing.map((e) => [e.key, e]));
  const ops: MergeOps = { insert: [], update: [], remove: [] };
  const kept = new Set<string>();
  for (const t of planned) {
    const e = byKey.get(t.key);
    kept.add(t.key);
    if (!e) { ops.insert.push(t); continue; }
    ops.update.push({ id: e.id, task: t, keepSteps: e.status !== "open" || e.touchedAt !== null || e.steps.some((s) => s.done) });
  }
  for (const e of existing) {
    if (!kept.has(e.key) && e.status === "open" && e.touchedAt === null && !e.steps.some((s) => s.done)) ops.remove.push(e.id);
  }
  return ops;
}

// --- keeping the schedule honest ---------------------------------------------
// Steps the student did not get to slide forward instead of piling up as
// overdue: spread from today to the day before the due date.
export function rollForward(steps: TaskStep[], today: string, dueAt: number | null): TaskStep[] {
  const late = steps.filter((s) => !s.done && s.doBy < today);
  if (!late.length) return steps;
  const last = dueAt === null ? addDays(today, 7) : addDays(sgtDate(dueAt), -1) < today ? sgtDate(dueAt) : addDays(sgtDate(dueAt), -1);
  const span = Math.max(0, Math.round((Date.parse(`${last}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000));
  let i = 0;
  return steps.map((s) => {
    if (s.done || s.doBy >= today) return s;
    const day = addDays(today, span === 0 ? 0 : Math.min(span, Math.floor((i++ * (span + 1)) / late.length)));
    return { ...s, doBy: day };
  }).sort((a, b) => a.doBy.localeCompare(b.doBy));
}

// No day should hold more than the student can do. Over the cap, the step
// with the most slack (its task due latest) moves to the next day, as long as
// that is still before its task is due. Returns the tasks whose steps moved.
export function balanceDays<T extends { key: string; dueAt: number | null; steps: TaskStep[] }>(
  tasks: T[], today: string, capFor: (date: string) => number, horizonDays = 21,
): Set<string> {
  const moved = new Set<string>();
  for (let d = 0; d < horizonDays; d++) {
    const day = addDays(today, d);
    const todays = tasks.flatMap((t) => t.steps.filter((s) => !s.done && s.doBy === day).map((s) => ({ t, s })));
    let load = todays.reduce((n, x) => n + x.s.minutes, 0);
    const cap = capFor(day);
    if (load <= cap) continue;
    // Most slack first; an undated task has the most.
    const slack = (x: { t: T }) => x.t.dueAt ?? Number.MAX_SAFE_INTEGER;
    todays.sort((a, b) => slack(b) - slack(a));
    for (const x of todays) {
      if (load <= cap) break;
      const next = addDays(day, 1);
      const deadline = x.t.dueAt === null ? addDays(today, horizonDays) : addDays(sgtDate(x.t.dueAt), -1);
      if (next > deadline) continue;
      x.s.doBy = next;
      load -= x.s.minutes;
      moved.add(x.t.key);
    }
  }
  for (const t of tasks) if (moved.has(t.key)) t.steps.sort((a, b) => a.doBy.localeCompare(b.doBy));
  return moved;
}

export const dailyCap = (date: string) => {
  const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
  return dow === 0 || dow === 6 ? 240 : 180;
};

// --- hints from files --------------------------------------------------------
// A line counts when it states an obligation outright, or when it pairs a
// week number or a percentage with something the student does. Lecture
// content is full of "project", "test" and percentages that are not work.
const STRONG_RE = /\b(due|deadline|submit(ted|ting)?|submission|quiz(zes)?|mid-?terms?|final exam|exam date|assignment \d|milestones?|graded|weightage|deliverables?|compulsory|pre-?(lecture|class|tutorial|reading)|before (the )?(next )?(lecture|class|tutorial|lab|seminar)|read(ing)?s? (chapter|ch\.|section))\b/i;
const WHEN_RE = /\bweek \d{1,2}\b|\brecess week\b|\breading week\b|\b\d{1,2}\s?%/i;
const ACT_RE = /\b(quiz|report|project|assignment|exam|ctf|participation|lab|tutorial|presentation|essay|test|set ?up|install|prepare|complete|finish|sorted|register|sign ?up|form)\w*/i;
const isObligation = (line: string) => STRONG_RE.test(line) || (WHEN_RE.test(line) && ACT_RE.test(line));

// Lines from a file's extracted text that read like an obligation, with the
// page they are on. pdf-parse marks page ends as "-- n of m --".
export function obligationLines(text: string, max = 12): { page: number; text: string }[] {
  const out: { page: number; text: string }[] = [];
  const pages = text.split(/--\s*\d+\s*of\s*\d+\s*--/);
  const seen = new Set<string>();
  pages.forEach((body, i) => {
    for (const raw of body.split(/\n+/)) {
      const line = raw.replace(/\s+/g, " ").trim();
      if (line.length < 14 || line.length > 400 || !isObligation(line)) continue;
      const norm = line.toLowerCase();
      if (seen.has(norm)) continue;
      seen.add(norm);
      out.push({ page: i + 1, text: clip(line, 200) });
    }
  });
  // Lines that name a date or a week are worth most.
  const score = (l: string) => (/\b(week \d|\d{1,2} (jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)|\d{1,2}\/\d{1,2}|due|deadline)\b/i.test(l) ? 1 : 0);
  return out.sort((a, b) => score(b.text) - score(a.text) || a.page - b.page).slice(0, max);
}
