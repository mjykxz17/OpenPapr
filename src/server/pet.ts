import { and, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { components, items, modules, tasks } from "@/db/schema";
import { getNusmods } from "@/db/profiles-repo";
import { moduleCodes } from "@/connectors/nusmods/client";
import { htmlToText } from "@/lib/html-text";

// Papi, the paper creature at the bottom of every page. Everything it says
// about the student's work comes from here: a plain-text sheet of facts built
// from what OpenPapr already synced, so the model answering questions (or the
// rule-based fallback when there is no model) never has to guess.

const H = 3_600_000;
const D = 24 * H;
const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function sgt(ms: number): string {
  const d = new Date(ms + 8 * H);
  const hh = String(d.getUTCHours()).padStart(2, "0"), mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${WEEKDAY[d.getUTCDay()]} ${d.getUTCDate()} ${MONTH[d.getUTCMonth()]}, ${hh}:${mm}`;
}
const sgtDay = (ms: number) => sgt(ms).replace(/, \d\d:\d\d$/, "");

export type Due = {
  id: number; code: string | null; title: string; kind: string; dueAt: number;
  done: boolean; missing: boolean; weightPct: number | null; weightName: string | null;
};

const KIND_RE: [RegExp, string][] = [
  [/\bquiz(zes)?\b/i, "quiz"], [/\b(mid-?term|final|exam|test)\b/i, "exam"], [/\b(lab|practical)\b/i, "lab"],
  [/\btutorial\b/i, "tutorial"], [/\b(project|milestone)\b/i, "project"], [/\b(presentation|present)\b/i, "presentation"],
  [/\b(report|essay|assignment|homework|problem set|submission)\b/i, "assignment"],
];
export const kindOf = (title: string, type: string) =>
  type === "discussion" ? "discussion" : type === "planner_note" ? "note" : type === "event" ? "class" : KIND_RE.find(([re]) => re.test(title))?.[1] ?? "assignment";

// Everything with a date the student could ask about, oldest first.
export function dueList(db: Db, userId: number, now: number): Due[] {
  const mods = new Map(db.select().from(modules).where(eq(modules.userId, userId)).all().filter((m) => m.active).map((m) => [m.id, m]));
  const comps = db.select().from(components).all().filter((c) => mods.has(c.moduleId));
  const rows = db.select().from(items).where(eq(items.userId, userId)).all()
    .filter((i) => i.dueAt !== null && !i.dismissed && (i.moduleId === null ? i.type === "planner_note" : mods.has(i.moduleId)))
    .filter((i) => ["assignment", "deadline", "discussion", "planner_note", "event"].includes(i.type))
    .filter((i) => i.dueAt! >= now - 14 * D && i.dueAt! <= now + (i.type === "event" ? 14 : 120) * D);
  const seenEvent = new Set<string>();
  const out: Due[] = [];
  for (const i of rows.sort((a, b) => a.dueAt! - b.dueAt!)) {
    if (i.type === "event") {  // a weekly class only needs its next occurrence
      const k = `${i.moduleId}:${i.title}`;
      if (i.dueAt! < now || seenEvent.has(k)) continue;
      seenEvent.add(k);
    }
    const code = i.moduleId ? mods.get(i.moduleId)!.code : null;
    // The component a piece of work counts toward ("Quizzes, 40%") — the
    // component's total, not this item's own share.
    const comp = comps.filter((c) => c.moduleId === i.moduleId && c.weightPct != null)
      .find((c) => i.title.toLowerCase().includes(c.name.toLowerCase().replace(/(zes|es|s)$/, "")));
    out.push({ id: i.id, code, title: i.title, kind: kindOf(i.title, i.type), dueAt: i.dueAt!, done: i.submitted || i.canvasDone, missing: i.missing, weightPct: comp?.weightPct ?? null, weightName: comp?.name ?? null });
  }
  return out;
}

export function recentlySaid(db: Db, userId: number, now: number): Said[] {
  const mods = new Map(db.select().from(modules).where(and(eq(modules.userId, userId), eq(modules.active, true))).all().map((m) => [m.id, m.code]));
  return db.select().from(items).where(eq(items.userId, userId)).all()
    .filter((i) => (i.type === "announcement" || i.type === "staff_reply") && i.moduleId !== null && mods.has(i.moduleId) && (i.sourceCreatedAt ?? i.firstSeenAt) > now - 21 * D)
    .sort((a, b) => (b.sourceCreatedAt ?? b.firstSeenAt) - (a.sourceCreatedAt ?? a.firstSeenAt))
    .map((i) => ({ code: mods.get(i.moduleId!) ?? null, who: i.type === "staff_reply" ? (i.sender ?? "Lecturer") : "Announcement", title: i.title.replace(/^Re: /, ""), at: i.sourceCreatedAt ?? i.firstSeenAt }));
}

// The sheet of facts handed to the model with every question.
export function factSheet(db: Db, userId: number, now: number): string {
  const mods = db.select().from(modules).where(and(eq(modules.userId, userId), eq(modules.active, true))).all();
  const lines: string[] = [`Now: ${sgt(now)} (Singapore time)`, "", "Modules:"];
  for (const m of mods) {
    const w = db.select().from(components).where(eq(components.moduleId, m.id)).all().filter((c) => c.weightPct != null);
    let exam = "";
    for (const code of moduleCodes(m.code)) {
      const d = (getNusmods(db, code)?.module?.examDates ?? []).map((x) => Date.parse(x)).filter((t) => t > now - D).sort((a, b) => a - b)[0];
      if (d) { exam = `; final exam ${sgt(d)} (NUSMods)`; break; }
    }
    lines.push(`- ${m.code} ${m.name}${w.length ? `; weightage: ${w.map((c) => `${c.name} ${c.weightPct}%`).join(", ")}` : ""}${exam}`);
  }
  const due = dueList(db, userId, now);
  lines.push("", "Dated work (past two weeks and ahead):");
  for (const d of due) {
    const state = d.done ? "done" : d.missing ? "MISSING on Canvas" : d.dueAt < now ? "past due" : "open";
    lines.push(`- ${d.code ?? "personal"} | ${d.kind} | ${d.title} | due ${sgt(d.dueAt)} | ${state}${d.weightPct ? ` | counts toward ${d.weightName} (${d.weightPct}% of grade in total)` : ""}`);
  }
  if (!due.length) lines.push("- (nothing dated)");
  const open = db.select().from(tasks).where(and(eq(tasks.userId, userId), eq(tasks.status, "open"))).all();
  if (open.length) {
    lines.push("", "Planned tasks (OpenPapr's plan, with steps):");
    const codes = new Map(mods.map((m) => [m.id, m.code]));
    for (const t of open.slice(0, 25)) {
      let steps: { text: string; doBy: string; done: boolean }[] = [];
      try { steps = JSON.parse(t.stepsJson); } catch { /* none */ }
      const next = steps.find((s) => !s.done);
      lines.push(`- ${t.moduleId ? codes.get(t.moduleId) : "personal"} | ${t.title} | ${t.dueAt ? `due ${sgt(t.dueAt)}${t.dueConfidence === "estimated" ? " (estimated)" : ""}` : "no date yet"}${t.anticipated ? " | anticipated" : ""} | ${steps.filter((s) => s.done).length}/${steps.length} steps${next ? ` | next: ${next.text} by ${next.doBy}` : ""}${t.why ? ` | ${t.why}` : ""}`);
    }
  }
  const said = db.select().from(items).where(eq(items.userId, userId)).all()
    .filter((i) => (i.type === "announcement" || i.type === "staff_reply") && (i.sourceCreatedAt ?? i.firstSeenAt) > now - 21 * D && i.moduleId !== null && mods.some((m) => m.id === i.moduleId))
    .sort((a, b) => (b.sourceCreatedAt ?? b.firstSeenAt) - (a.sourceCreatedAt ?? a.firstSeenAt)).slice(0, 12);
  if (said.length) {
    lines.push("", "What the courses said recently (announcements, and lecturers' replies in discussions):");
    const codes = new Map(mods.map((m) => [m.id, m.code]));
    for (const a of said) {
      const who = a.type === "staff_reply" ? `${a.sender ?? "Lecturer"} in a discussion` : "announcement";
      lines.push(`- ${codes.get(a.moduleId!)} | ${sgtDay(a.sourceCreatedAt ?? a.firstSeenAt)} | ${who} | ${a.title}: ${htmlToText(a.body).replace(/\s+/g, " ").slice(0, 350)}`);
    }
  }
  return lines.join("\n").slice(0, 16_000);
}

// --- answering without a model --------------------------------------------------
// Enough for the common questions ("when is the next quiz for 4238?", "what's
// due this week?") when the student has not added an AI key.
export type Said = { code: string | null; who: string; title: string; at: number };
export function ruleAnswer(question: string, due: Due[], codes: string[], now: number, said: Said[] = []): string {
  const q = question.toLowerCase();
  const digits = q.match(/\b[a-z]{0,4}\s?(\d{4})[a-z]{0,2}\b/)?.[1];
  const code = codes.find((c) => (digits && c.includes(digits)) || q.includes(c.toLowerCase()));
  if (/\b(missing|overdue|late|behind)\b/.test(q)) {
    const late = due.filter((d) => !d.done && d.kind !== "class" && (d.missing || d.dueAt < now) && (!code || d.code === code));
    return late.length
      ? `${late.length === 1 ? "One thing" : `${late.length} things`}: ${late.slice(0, 5).map((d) => `${d.code ? `${d.code} ` : ""}${d.title} (${d.missing ? "Canvas says missing" : `was due ${sgt(d.dueAt)}`})`).join("; ")}.`
      : "Nothing missing that I can see. Look at you go.";
  }
  if (/\b(say|said|announce|announcement|lecturer|prof|professor|ta|update|news)\b/.test(q)) {
    const pool = said.filter((x) => !code || x.code === code).slice(0, 4);
    return pool.length
      ? `Recently: ${pool.map((x) => `${x.code ?? ""} ${x.who} — "${x.title}" (${sgtDay(x.at)})`.trim()).join("; ")}. Open the module page for the full text.`
      : `Nothing new from ${code ?? "your courses"} in the last three weeks.`;
  }
  const kind = KIND_RE.find(([re]) => re.test(q))?.[1] ?? (/\bdiscussion|forum|post\b/.test(q) ? "discussion" : null);
  const weekOnly = /\b(this week|week)\b/.test(q);
  const todayOnly = /\btoday|tonight\b/.test(q);
  let pool = due.filter((d) => d.dueAt >= now && !d.done && d.kind !== "class");
  if (code) pool = pool.filter((d) => d.code === code);
  if (kind) pool = pool.filter((d) => d.kind === kind);
  if (todayOnly) pool = pool.filter((d) => d.dueAt < now + D);
  else if (weekOnly) pool = pool.filter((d) => d.dueAt < now + 7 * D);
  const what = `${kind ?? "thing due"}${code ? ` for ${code}` : ""}`;
  const missing = due.filter((d) => d.missing && (!code || d.code === code));
  const tail = missing.length ? ` Also — Canvas says ${missing[0].title} is missing.` : "";
  if (!pool.length) return `I can't see any upcoming ${what} in what Canvas has given me.${tail} If it was only mentioned in class, it won't be here yet.`;
  const fmt = (d: Due) => `${d.code ? `${d.code} ` : ""}${d.title} — ${sgt(d.dueAt)}${d.weightPct ? ` (part of ${d.weightName}, ${d.weightPct}%)` : ""}`;
  if (/\bnext\b/.test(q) || pool.length === 1) return `Next ${what}: ${fmt(pool[0])}.${tail}`;
  return `${pool.length > 5 ? "The next five" : "Coming up"}: ${pool.slice(0, 5).map(fmt).join("; ")}.${tail}`;
}

// --- the things Papi says unprompted -----------------------------------------------
export function reminders(db: Db, userId: number, now: number): string[] {
  const out: string[] = [];
  const due = dueList(db, userId, now).filter((d) => !d.done && d.kind !== "class");
  for (const d of due.filter((d) => d.missing).slice(0, 2)) out.push(`Psst. Canvas thinks ${d.code ? `${d.code} ` : ""}${d.title} is missing. Might be worth a look.`);
  for (const d of due.filter((d) => d.dueAt >= now && d.dueAt < now + 2 * D).slice(0, 3)) {
    const hrs = Math.round((d.dueAt - now) / H);
    out.push(hrs < 12
      ? `${d.code ?? ""} ${d.title} is due in about ${Math.max(1, hrs)} hour${hrs === 1 ? "" : "s"}. I believe in you. Mostly.`.trim()
      : `Heads up: ${d.code ? `${d.code} ` : ""}${d.title} is due ${sgt(d.dueAt)}.${d.weightPct ? ` It counts toward ${d.weightName} (${d.weightPct}%).` : ""}`);
  }
  const today = new Date(now + 8 * H).toISOString().slice(0, 10);
  const steps = db.select().from(tasks).where(and(eq(tasks.userId, userId), eq(tasks.status, "open"))).all().flatMap((t) => {
    try { return (JSON.parse(t.stepsJson) as { text: string; doBy: string; done: boolean; minutes: number }[]).filter((s) => !s.done && s.doBy <= today); } catch { return []; }
  });
  if (steps.length) {
    const mins = steps.reduce((n, s) => n + s.minutes, 0);
    out.push(`${steps.length} step${steps.length > 1 ? "s" : ""} on today's list (${mins >= 60 ? `${Math.floor(mins / 60)}h${mins % 60 ? ` ${mins % 60}m` : ""}` : `${mins}m`}). Smallest first? "${steps.sort((a, b) => a.minutes - b.minutes)[0].text}"`);
  }
  const reply = db.select().from(items).where(and(eq(items.userId, userId), eq(items.type, "staff_reply"))).all()
    .filter((i) => (i.sourceCreatedAt ?? i.firstSeenAt) > now - 2 * D).sort((a, b) => (b.sourceCreatedAt ?? 0) - (a.sourceCreatedAt ?? 0))[0];
  if (reply) out.push(`${reply.sender ?? "A lecturer"} just replied in "${reply.title.replace(/^Re: /, "")}". I read it. You should too.`);
  const post = due.find((d) => d.kind === "discussion" && d.dueAt > now && d.dueAt < now + 3 * D);
  if (post) out.push(`You still owe a post in "${post.title}". Even a short one counts!`);
  return out;
}

const QUIPS = [
  "I'm made of paper. Please don't spill coffee near me.",
  "Fun fact: I've read every announcement so you don't have to. You're welcome.",
  "Hydration check. I can't drink, but you can.",
  "If procrastination were graded, you'd be on the Dean's List. Kidding. Mostly.",
  "I folded myself into a tiny swan earlier. Nobody saw. Tragic.",
  "Your future self called. They said thanks for starting early.",
  "Stretch break? I'd join you but I only have two very small feet.",
  "Reminder: the syllabus is not a horror novel. Read it anyway.",
  "I tried to write a study guide once. It was just the word 'vibes' 400 times.",
  "Five minutes of work beats fifty minutes of planning to work.",
  "I'm not saying you should open that PDF. I'm just looking at it. Meaningfully.",
  "Canvas hasn't posted anything new. Suspicious. I'm keeping watch.",
  "Somewhere, a TA is marking scripts and thinking of you. Make it a good thought.",
  "One Pomodoro and then snacks. That's the deal.",
  "I don't sleep. Well. From 1 to 7am I do. Very important paper business.",
];
export function quips(codes: string[], now: number): string[] {
  const hour = new Date(now + 8 * H).getUTCHours();
  const out = [...QUIPS];
  if (codes.length) {
    const c = codes[Math.floor((now / H) % codes.length)];
    out.push(`${c} again? I'm starting to think it's your favourite.`, `${c} posts more announcements than I have folds. And I have a lot of folds.`);
  }
  if (hour >= 23 || hour < 1) out.push("It's late. Your brain does its best filing while you sleep, you know.");
  if (hour >= 6 && hour < 10) out.push("Morning! I've warmed up your deadlines for you.");
  return out;
}

export const PET_SYSTEM = `You are Papi, a small, cheerful paper creature who lives at the bottom of OpenPapr, a study app for an NUS student. You help them keep track of their modules.

Answer ONLY from the FACTS below. Rules:
- Dates and times are Singapore time; say the weekday ("Wed 1 Oct, 23:59"). "Next" means the first one after Now that is not done.
- Match modules loosely: "4238" means CS4238; "stats" can mean ST2334.
- If the facts don't contain the answer, say so plainly and suggest where to look (the module page, Canvas, or asking the lecturer). Never invent a date, a weightage or what a quiz covers.
- When something is "estimated" or "anticipated", say it's OpenPapr's guess.
- Be brief: at most 3 short sentences or a tiny list. Warm, a little playful, never sarcastic about the student. No emoji and no markdown (no **, #, or tables): plain sentences, or short lines starting with "- ".`;
