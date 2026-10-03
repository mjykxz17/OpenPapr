import { z } from "zod";
import { chatJson, isImageRefusal, type CompatConfig, type ContentPart } from "./openai-compat";

// The course roadmap. Lecturers set out the semester once — a "Schedule"
// table in the first lecture, an "Assessment" slide in the admin deck, the
// syllabus page, the welcome announcement — and everything later is a
// change to it. Reading that schedule first is how a quiz that only exists
// as "Quiz 2, Week 8, in lecture" gets a date: the week maps to the NUS
// calendar and the lecture to the module's weekly Canvas class slot.
//
// This file is pure: the worker picks the sources and stores the result.

export const ROADMAP_KINDS = ["quiz", "test", "midterm", "exam", "assignment", "lab", "project", "presentation", "tutorial", "other"] as const;

export type RoadmapSource = { ref: string; label: string; text: string };
// A slide whose schedule is a picture (a pasted table): its text is just a
// title, so the page itself is sent to models that read images.
export type RoadmapImage = { ref: string; label: string; page: number; png: Uint8Array };

const Raw = z.object({
  title: z.string().min(2).max(120),
  kind: z.enum(ROADMAP_KINDS).catch("other"),
  week: z.union([z.number().int(), z.string()]).nullish(),
  date: z.string().nullish(),
  time: z.string().nullish(),
  slot: z.string().max(40).nullish(),
  weightPct: z.number().min(0).max(100).nullish(),
  covers: z.string().max(160).nullish(),
  ref: z.string(),
  page: z.number().int().positive().nullish(),
  quote: z.string().max(240).nullish(),
});

export type RoadmapItem = {
  title: string; kind: (typeof ROADMAP_KINDS)[number];
  week: number | "recess" | "reading" | null;   // teaching week 1–13, or a break
  date: string | null;                          // YYYY-MM-DD when the source gives one
  time: string | null;                          // HH:MM when the source gives one
  slot: string | null;                          // "lecture", "tutorial", "lab", "online", …
  weightPct: number | null; covers: string | null;
  ref: string; page: number | null; quote: string | null;
};

export const ROADMAP_SYSTEM = `You read a university course's own schedule. You get the text of the places a lecturer sets out the semester — the syllabus, the first lecture or admin slides, the welcome announcement — each with a ref and its pages marked "-- N of M --" AFTER each page's text.

List every assessment and deliverable the course schedules: quizzes, tests, midterms, finals, assignments, labs that are graded or submitted, projects and their milestones, presentations, and graded tutorials. Skip ordinary lectures, ungraded tutorials, readings and holidays.

For each give:
- title: as the course names it ("Quiz 2", "Assignment 1: Buffer overflows", "Project milestone v1.2").
- kind: quiz | test | midterm | exam | assignment | lab | project | presentation | tutorial | other.
- week: the NUS teaching week number it falls in or is due (1-13), "recess" or "reading" — only if the source says so (a schedule row, "Week 8", "after recess"). Otherwise null.
- date: YYYY-MM-DD only if the source states a calendar date. Never compute one from a week.
- time: HH:MM (24h) only if stated.
- slot: when it happens in the week if stated: "lecture", "tutorial", "lab", "online", "take-home".
- weightPct, covers (e.g. "L1-L5"): if stated.
- ref and page: where you read it; quote: the phrase, under 200 characters.

Some slides come as images after the text, labelled with their ref and page — usually a schedule table pasted as a picture. Read them like text: each row is a week; a cell in a "Quiz", "Assignment", "Incident" or "Project" column is an assessment in that week. Cite their ref and page.

Copy what the source says; do not guess. One entry per assessment instance ("Quizzes in Weeks 3, 5, 7" is three entries). If the sources hold no schedule, return an empty list.

Return ONLY JSON: {"items": [{"title": "", "kind": "", "week": null, "date": null, "time": null, "slot": null, "weightPct": null, "covers": null, "ref": "", "page": null, "quote": ""}]}`;

export function roadmapPrompt(module: { code: string; name: string }, sources: RoadmapSource[]): string {
  return [
    `Module: ${module.code} ${module.name}`,
    ...sources.map((s) => `=== [${s.ref}] ${s.label} ===\n${s.text}`),
  ].join("\n\n");
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]?\d|2[0-3]):[0-5]\d$/;

// Keeps entries that cite a real source and say something placeable.
// Models sometimes cite a source by its name ("CS4238-Lec01A.pdf") or with
// the brackets ("[F36]") instead of the ref; map those back.
export function refResolver(refs: Set<string>, labels: { ref: string; label: string }[] = []): (r: string) => string | null {
  const norm = (x: string) => x.toLowerCase().replace(/\.(pdf|pptx?|docx?)$/i, "").replace(/[^a-z0-9]+/g, "");
  const byLabel = new Map(labels.flatMap((l) => [[norm(l.label), l.ref], [norm(l.label.replace(/^[a-z ]+:\s*/i, "")), l.ref]] as [string, string][]));
  return (r) => {
    const t = r.trim().replace(/^\[|\]$/g, "").replace(/\s*p(age)?\.?\s*\d+$/i, "");
    if (refs.has(t)) return t;
    return byLabel.get(norm(t)) ?? byLabel.get(norm(t.replace(/^(announcement|file|slides?)\s*:\s*/i, ""))) ?? null;
  };
}

export function cleanRoadmap(raw: unknown, refs: Set<string>, resolve: (r: string) => string | null = (r) => (refs.has(r) ? r : null)): RoadmapItem[] | null {
  const top = z.object({ items: z.array(z.unknown()).max(80).default([]) }).safeParse(raw);
  if (!top.success) return null;
  const out: RoadmapItem[] = [];
  const seen = new Set<string>();
  for (const r of top.data.items) {
    const p = Raw.safeParse(r);
    const ref = p.success ? resolve(p.data.ref) : null;
    if (!p.success || !ref) continue;
    const w = p.data.week;
    const week = typeof w === "number" ? (w >= 1 && w <= 13 ? w : null)
      : typeof w === "string" ? (/recess/i.test(w) ? "recess" : /reading/i.test(w) ? "reading" : /^\d{1,2}$/.test(w.trim()) && +w >= 1 && +w <= 13 ? +w : null)
      : null;
    const date = p.data.date && DATE_RE.test(p.data.date) && !Number.isNaN(Date.parse(p.data.date)) ? p.data.date : null;
    const time = p.data.time && TIME_RE.test(p.data.time) ? p.data.time.padStart(5, "0") : null;
    const key = `${p.data.title.toLowerCase()}|${week ?? ""}|${date ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      title: p.data.title.trim(), kind: p.data.kind, week, date, time, slot: p.data.slot?.trim().toLowerCase() || null,
      weightPct: p.data.weightPct ?? null, covers: p.data.covers?.trim() || null,
      ref, page: p.data.page ?? null, quote: p.data.quote?.trim() || null,
    });
  }
  return out;
}

export type RoadmapResult = { items: RoadmapItem[]; imagesRead: number; imagesRefused: boolean };

export async function extractRoadmap(
  cfg: CompatConfig, module: { code: string; name: string }, sources: RoadmapSource[], fetchFn: typeof fetch = fetch, images: RoadmapImage[] = [],
): Promise<RoadmapResult> {
  if (!sources.length && !images.length) return { items: [], imagesRead: 0, imagesRefused: false };
  const refs = new Set([...sources.map((s) => s.ref), ...images.map((i) => i.ref)]);
  const resolve = refResolver(refs, [...sources, ...images]);
  const text = roadmapPrompt(module, sources);
  const withImages: ContentPart[] = [
    { type: "text", text },
    ...images.flatMap((im): ContentPart[] => [
      { type: "text", text: `=== [${im.ref}] ${im.label}, page ${im.page} (image; cite ref "${im.ref}", page ${im.page}) ===` },
      { type: "image_url", image_url: { url: `data:image/png;base64,${Buffer.from(im.png).toString("base64")}` } },
    ]),
  ];
  let send: string | ContentPart[] = images.length ? withImages : text;
  let refused = false;
  let items: RoadmapItem[] | null = null;
  for (let attempt = 0; attempt < 2 && items === null; attempt++) {
    try {
      items = cleanRoadmap(await chatJson(cfg, fetchFn, ROADMAP_SYSTEM, send, 5000), refs, resolve);
    } catch (err) {
      // A model that can't read images still gets the text.
      if (typeof send !== "string" && isImageRefusal(err)) { refused = true; send = text; attempt--; continue; }
      throw err;
    }
  }
  if (!items) throw new Error("the model's roadmap was not in the expected shape");
  return { items, imagesRead: refused ? 0 : images.length, imagesRefused: refused };
}

// Pages that are a picture with a title on top: little text, and either a
// schedule-like title or among the first slides.
const PICTURE_TITLE_RE = /schedule|timeline|calendar|assessment|grading|week|plan|overview|deadline/i;
export function picturePages(text: string, max = 4): number[] {
  const parts = text.split(/--\s*\d+\s*of\s*\d+\s*--/);
  const out: number[] = [];
  parts.forEach((body, i) => {
    const words = body.replace(/\s+/g, " ").trim();
    if (words.length > 0 && words.length < 70 && PICTURE_TITLE_RE.test(words)) out.push(i + 1);
  });
  return out.slice(0, max);
}
// --- choosing what to read ----------------------------------------------------
const SCHEDULE_RE = /\b(week|wk)\s*\d|schedule|timeline|assessment|quiz|test|mid-?term|exam|deadline|\bdue\b|submission|presentation|project|milestone|\blab\b|tutorial|recess|reading week/i;

// The pages of a deck worth sending: the first few (where the admin slides
// are) and any that look like a schedule, capped. pdf-parse puts the
// "-- N of M --" marker after each page's text; the markers are kept so the
// model can cite pages.
export function schedulePages(text: string, maxPages = 18, maxChars = 12_000): string {
  const parts = text.split(/(--\s*\d+\s*of\s*\d+\s*--)/);
  const pages: { body: string; marker: string; n: number }[] = [];
  for (let i = 0; i < parts.length; i += 2) {
    const body = parts[i] ?? "";
    const marker = parts[i + 1] ?? "";
    if (!body.trim() && !marker) continue;
    pages.push({ body: body.trim(), marker, n: pages.length + 1 });
  }
  const keep = pages.filter((p) => p.n <= 4 || SCHEDULE_RE.test(p.body)).slice(0, maxPages);
  let out = "";
  for (const p of keep) {
    const chunk = `${p.body.replace(/[ \t]+/g, " ").slice(0, 2500)}\n${p.marker || `-- ${p.n} --`}\n`;
    if (out.length + chunk.length > maxChars) break;
    out += chunk;
  }
  return out;
}

// Files whose names say "this is where the course plan lives".
export const ROADMAP_FILE_RE = /(prelim|intro|overview|outline|admin|course.?info|module.?info|syllabus|schedule|roadmap|timeline|assess|week.?0?[01]\b|lec(ture)?.?0?[01]\b|\bl0?[01]\b|\bu0?[01]\b|\bw0?[01]\b|briefing|welcome)/i;
