import { z } from "zod";
import { chatJson, type CompatConfig } from "./openai-compat";
import type { NusmodsModule, Review } from "../connectors/nusmods/client";

// The agentic layer: what OpenPapr knows about each module and about the
// student, rebuilt by the student's own model whenever its inputs change.
// Every synthesis is told to stay inside its inputs — a profile that invents
// a lecturer's research area or a review that was never written is worse
// than a shorter profile.

const str = z.string().trim();
const list = (max: number) => z.array(str).max(max * 2).transform((a) => a.filter(Boolean).slice(0, max));

// --- module profile ---------------------------------------------------------
export const ModuleProfile = z.object({
  oneLine: str,
  covers: list(6),
  assessment: str.nullable().optional().transform((v) => v ?? null),
  lecturers: z.array(z.object({
    name: str,
    background: str.nullable().optional().transform((v) => v ?? null),
    emphasis: list(4),
  })).max(6).default([]),
  studentsSay: z.object({
    workload: str.nullable().optional().transform((v) => v ?? null),
    difficulty: str.nullable().optional().transform((v) => v ?? null),
    tips: list(5),
    pitfalls: list(4),
  }).nullable().optional().transform((v) => v ?? null),
  fit: z.object({
    buildsOn: list(5),
    gaps: list(4),
    relevance: str.nullable().optional().transform((v) => v ?? null),
  }),
  howToStudy: list(5),
});
export type ModuleProfile = z.infer<typeof ModuleProfile>;

export type ModuleProfileInput = {
  module: { code: string; name: string; term: string | null };
  nusmods: NusmodsModule | null;
  reviews: Review[];
  reviewTotal: number;
  lecturers: { name: string; pageText: string | null }[];
  components: { name: string; weightPct: number }[];
  announcements: { title: string; text: string; postedAt: string | null }[];
  fileNames: string[];
  student: { major: string | null; year: number | null; history: string[] };
};

const MODULE_SYSTEM = `You build a study profile of one university module for one NUS student. You will get: the official NUSMods record, student reviews from NUSMods (public, anonymous), the lecturers' names and, when available, text from their public NUS staff pages, the module's assessment weightage, recent announcements, the names of course files, and the student's major, year and previous courses.

Return ONLY a JSON object, no prose and no code fences:
{"oneLine": "<what this module is really about, one sentence>",
 "covers": ["<main topic>", ...up to 6],
 "assessment": "<one line on how it is assessed, from the weightage; null if unknown>",
 "lecturers": [{"name": "<as given>", "background": "<research/teaching areas from their staff page text; null if no page text>", "emphasis": ["<what their announcements and materials stress>", ...up to 4]}],
 "studentsSay": {"workload": "<one line>", "difficulty": "<one line>", "tips": ["..."], "pitfalls": ["..."]} or null when there are no reviews,
 "fit": {"buildsOn": ["<one of the student's previous courses this builds on, with why>"], "gaps": ["<prerequisite knowledge the student's history does not show>"], "relevance": "<why this matters for their major, one line; null if major unknown>"},
 "howToStudy": ["<specific, actionable advice for this module>", ...up to 5]}

Rules:
- Use only the inputs. Never invent a lecturer's background, a review, a topic or a course the student took. If an input is missing, leave that part null or empty.
- Background describes professional areas only (research interests, fields taught). Never include personal details, and never rate or judge a lecturer as a person.
- Reviews span several years and lecturers; treat them as tendencies ("several reviews say…"), prefer recent ones, and mention when advice depends on who teaches it.
- Keep every string under 200 characters. Plain words, no emoji, no marketing tone.`;

export function moduleProfilePrompt(input: ModuleProfileInput): string {
  const nm = input.nusmods;
  const parts: string[] = [];
  parts.push(`=== MODULE ===\n${input.module.code} — ${input.module.name}${input.module.term ? ` (${input.module.term})` : ""}`);
  parts.push(nm
    ? `=== NUSMODS ===\nTitle: ${nm.title}\nCredits: ${nm.moduleCredit ?? "?"} · ${nm.department ?? ""} · ${nm.faculty ?? ""}\nWorkload (lec,tut,lab,proj,prep h/wk): ${Array.isArray(nm.workload) ? nm.workload.join(",") : nm.workload ?? "?"}\nPrerequisite: ${nm.prerequisite ?? "none listed"}\nPreclusion: ${nm.preclusion ?? "none"}\nDescription: ${nm.description}`
    : "=== NUSMODS ===\n(not found)");
  parts.push(input.reviews.length
    ? `=== NUSMODS REVIEWS (${input.reviews.length} shown of ${input.reviewTotal}) ===\n` + input.reviews.map((r) => `[${r.createdAt.slice(0, 7) || "undated"} · ${r.likes} likes] ${r.text}`).join("\n\n")
    : "=== NUSMODS REVIEWS ===\n(none)");
  parts.push(`=== LECTURERS ===\n` + (input.lecturers.length
    ? input.lecturers.map((l) => `${l.name}${l.pageText ? `\nStaff page:\n${l.pageText.slice(0, 3000)}` : "\n(no staff page)"}`).join("\n\n")
    : "(unknown)"));
  parts.push(`=== ASSESSMENT WEIGHTAGE ===\n${input.components.length ? input.components.map((c) => `${c.name}: ${c.weightPct}%`).join("\n") : "(unknown)"}`);
  parts.push(`=== RECENT ANNOUNCEMENTS ===\n${input.announcements.length ? input.announcements.map((a) => `# ${a.title} (${a.postedAt?.slice(0, 10) ?? ""})\n${a.text.slice(0, 800)}`).join("\n\n") : "(none)"}`);
  parts.push(`=== COURSE FILES ===\n${input.fileNames.slice(0, 60).join("\n") || "(none)"}`);
  parts.push(`=== STUDENT ===\nMajor: ${input.student.major ?? "unknown"}\nYear: ${input.student.year ?? "unknown"}\nPrevious and current courses: ${input.student.history.join(", ") || "unknown"}`);
  return parts.join("\n\n");
}

export async function buildModuleProfile(cfg: CompatConfig, input: ModuleProfileInput, fetchFn: typeof fetch = fetch): Promise<ModuleProfile> {
  const raw = await chatJson(cfg, fetchFn, MODULE_SYSTEM, moduleProfilePrompt(input), 3000);
  const parsed = ModuleProfile.safeParse(raw);
  if (!parsed.success) throw new Error("the model's module profile was not in the expected shape");
  return groundModuleProfile(parsed.data, input);
}

// The rules in the prompt, enforced: no student verdicts without reviews, no
// lecturer background without a staff page, and no lecturer who is not on the
// course.
export function groundModuleProfile(p: ModuleProfile, input: ModuleProfileInput): ModuleProfile {
  const known = new Map(input.lecturers.map((l) => [l.name.toLowerCase(), l]));
  return {
    ...p,
    studentsSay: input.reviews.length ? p.studentsSay : null,
    lecturers: p.lecturers
      .filter((l) => known.has(l.name.toLowerCase()))
      .map((l) => ({ ...l, background: known.get(l.name.toLowerCase())!.pageText ? l.background : null })),
  };
}

// --- writing style ------------------------------------------------------------
export const WritingStyle = z.object({
  languages: str,
  tone: str,
  length: str,
  format: str,
  summary: str,
});
export type WritingStyle = z.infer<typeof WritingStyle>;

const STYLE_SYSTEM = `You describe how a student writes, from notes they took beside lecture slides, so study material can be written the way they think. Describe patterns, not content: languages and how they mix them, tone, how terse or detailed, and formatting habits (bullets, arrows, abbreviations, questions to self).

Return ONLY a JSON object: {"languages": "...", "tone": "...", "length": "...", "format": "...", "summary": "<one or two sentences a writer could follow>"}.
Rules: each value under 160 characters; do not quote the notes; do not guess at anything personal about the student.`;

export async function buildWritingStyle(cfg: CompatConfig, notes: string, fetchFn: typeof fetch = fetch): Promise<WritingStyle> {
  const raw = await chatJson(cfg, fetchFn, STYLE_SYSTEM, `=== NOTES ===\n${notes}`, 1200);
  const parsed = WritingStyle.safeParse(raw);
  if (!parsed.success) throw new Error("the model's style summary was not in the expected shape");
  return parsed.data;
}

// --- the student -------------------------------------------------------------
export const UserProfile = z.object({
  headline: str,
  background: list(5),
  strengths: list(4),
  watchOuts: list(4),
  thisSemester: str,
  guideVoice: str,
});
export type UserProfile = z.infer<typeof UserProfile>;

export type UserProfileInput = {
  major: string | null;
  year: number | null;
  history: { code: string; name: string; state: string }[];
  modules: { code: string; oneLine: string | null; gaps: string[]; workload: string | null }[];
  style: WritingStyle | null;
};

const USER_SYSTEM = `You write a short working profile of an NUS student for a study app, from their major, year, course history, this semester's module profiles and a description of how they write. The app uses it to pitch explanations at the right level and to plan their week.

Return ONLY a JSON object:
{"headline": "<who they are academically, one line>",
 "background": ["<what their course history says they already know>", ...up to 5],
 "strengths": ["<areas their history suggests they are strong in>", ...up to 4],
 "watchOuts": ["<gaps or heavy spots this semester>", ...up to 4],
 "thisSemester": "<one or two lines on the semester's load and shape>",
 "guideVoice": "<instructions to a writer on how to explain things to this student: level, what to assume, analogies from which fields, language and format>"}

Rules: infer only from course codes, names and the given profiles — never from grades, which you do not have. No personality judgements, nothing about health, background or identity. Each string under 240 characters.`;

export async function buildUserProfile(cfg: CompatConfig, input: UserProfileInput, fetchFn: typeof fetch = fetch): Promise<UserProfile> {
  const body = [
    `Major: ${input.major ?? "unknown"}; year: ${input.year ?? "unknown"}`,
    `Course history:\n${input.history.map((h) => `${h.code} ${h.name} (${h.state})`).join("\n") || "(unknown)"}`,
    `This semester:\n${input.modules.map((m) => `${m.code}: ${m.oneLine ?? "(no profile yet)"}${m.workload ? ` · workload: ${m.workload}` : ""}${m.gaps.length ? ` · gaps: ${m.gaps.join("; ")}` : ""}`).join("\n") || "(none)"}`,
    `How they write: ${input.style ? input.style.summary : "(unknown)"}`,
  ].join("\n\n");
  const raw = await chatJson(cfg, fetchFn, USER_SYSTEM, body, 1500);
  const parsed = UserProfile.safeParse(raw);
  if (!parsed.success) throw new Error("the model's student profile was not in the expected shape");
  return parsed.data;
}

// --- the week ----------------------------------------------------------------
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
export const WeeklyPlan = z.object({
  overview: str,
  priorities: z.array(z.object({
    module: str,
    focus: str,
    why: str,
  })).max(12).default([]),
  days: z.array(z.object({
    day: z.enum(DAYS),
    items: z.array(z.object({ module: str, task: str, minutes: z.coerce.number().int().min(5).max(480) })).max(6),
  })).max(7).default([]),
});
export type WeeklyPlan = z.infer<typeof WeeklyPlan>;

export type WeeklyPlanInput = {
  today: string;          // e.g. "Wed 23 Sep"
  daysLeft: string[];     // the days of this week still ahead, today included
  student: UserProfile | null;
  modules: { code: string; profile: ModuleProfile | null; components: { name: string; weightPct: number }[] }[];
  due: { module: string | null; title: string; due: string; kind: string }[];
};

const PLAN_SYSTEM = `You plan a university student's study week across their modules. You get today's date, the days left this week, a profile of the student, a profile of each module (with assessment weightage) and everything due in the next two weeks.

Return ONLY a JSON object:
{"overview": "<two sentences: what this week is about>",
 "priorities": [{"module": "<code>", "focus": "<what to focus on this week>", "why": "<the reason: a deadline, weightage, a known gap>"}],
 "days": [{"day": "Mon|Tue|Wed|Thu|Fri|Sat|Sun", "items": [{"module": "<code>", "task": "<concrete task>", "minutes": <number>}]}]}

Rules:
- One priority per module that needs attention, most urgent first. Tie every "why" to a given deadline, weightage or profile point — do not invent deadlines.
- Only plan the days listed as left. Keep each day realistic: at most 4 hours of tasks on weekdays, 6 on weekends.
- Tasks must be concrete ("do tutorial 5 Q1-4", "revise slides 12-30 of L6 before the quiz"), sized in minutes.
- Strings under 180 characters. No emoji.`;

export async function buildWeeklyPlan(cfg: CompatConfig, input: WeeklyPlanInput, fetchFn: typeof fetch = fetch): Promise<WeeklyPlan> {
  const body = [
    `Today: ${input.today}. Days left this week: ${input.daysLeft.join(", ")}.`,
    `Student: ${input.student ? `${input.student.headline}. Watch-outs: ${input.student.watchOuts.join("; ")}` : "(no profile)"}`,
    `Modules:\n${input.modules.map((m) => [
      `## ${m.code}`,
      m.profile ? `${m.profile.oneLine}\nStudy advice: ${m.profile.howToStudy.join("; ")}\nGaps: ${m.profile.fit.gaps.join("; ") || "none"}` : "(no profile)",
      m.components.length ? `Weightage: ${m.components.map((c) => `${c.name} ${c.weightPct}%`).join(", ")}` : "",
    ].filter(Boolean).join("\n")).join("\n\n")}`,
    `Due in the next two weeks:\n${input.due.map((d) => `${d.due} · ${d.module ?? "general"} · ${d.title} (${d.kind})`).join("\n") || "(nothing recorded)"}`,
  ].join("\n\n");
  const raw = await chatJson(cfg, fetchFn, PLAN_SYSTEM, body, 3000);
  const parsed = WeeklyPlan.safeParse(raw);
  if (!parsed.success) throw new Error("the model's plan was not in the expected shape");
  const left = new Set(input.daysLeft);
  return { ...parsed.data, days: parsed.data.days.filter((d) => left.has(d.day)) };
}

// --- the brief handed to the study-guide writer -------------------------------
export function readerBrief(user: UserProfile | null, style: WritingStyle | null, mod: ModuleProfile | null): string | null {
  const lines: string[] = [];
  if (user) {
    lines.push(`Reader: ${user.headline}`);
    if (user.background.length) lines.push(`They already know: ${user.background.join("; ")}`);
    lines.push(`How to explain to them: ${user.guideVoice}`);
  }
  if (style) lines.push(`They write like this, so match it where it helps: ${style.summary}`);
  if (mod) {
    if (mod.fit.gaps.length) lines.push(`Gaps to fill gently for this module: ${mod.fit.gaps.join("; ")}`);
    const emphasis = mod.lecturers.flatMap((l) => l.emphasis);
    if (emphasis.length) lines.push(`The lecturer stresses: ${emphasis.join("; ")}`);
    if (mod.studentsSay?.pitfalls.length) lines.push(`Where students commonly slip: ${mod.studentsSay.pitfalls.join("; ")}`);
  }
  return lines.length ? lines.join("\n").slice(0, 2500) : null;
}
