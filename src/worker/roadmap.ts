import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { files, items, moduleRoadmaps, modules } from "../db/schema";
import { extractRoadmap, picturePages, ROADMAP_FILE_RE, schedulePages, type RoadmapImage, type RoadmapItem, type RoadmapSource } from "../enrich/roadmap";
import type { CompatConfig } from "../enrich/openai-compat";
import type { SignalItem, TaskSource } from "../enrich/tasks";
import { htmlToText } from "../lib/html-text";
import { semesterWeeks } from "../lib/acad-week";

// Reads each module's schedule once (and again when its sources change) and
// turns it into lines the task planner can act on, with "Week 8, in
// lecture" already resolved to a day and time where the calendar allows.

const H = 3_600_000;
const D = 24 * H;
const SGT = 8 * H;
const REREAD_AFTER = 7 * D;       // even unchanged, a fresh read weekly
const ERROR_BACKOFF = 6 * H;
const PER_RUN = 2;
const MAX_FILES = 3;

type Mod = typeof modules.$inferSelect;
type FileRow = typeof files.$inferSelect;
type SourceRef = { ref: string; label: string; fileId?: number; itemId?: number };

export type RoadmapDeps = {
  db: Db;
  now: () => number;
  cfgFor: (userId: number) => CompatConfig | null;
  fileText: (userId: number, file: FileRow, mod: Mod) => Promise<string | null>;
  // One page of a file drawn as a PNG, for schedules pasted as pictures.
  pageImage?: (userId: number, file: FileRow, mod: Mod, page: number) => Promise<Uint8Array | null>;
  fetchFn?: typeof fetch;
};

const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex").slice(0, 32);
const parseList = <T,>(json: string | null | undefined): T[] => {
  try { const v = JSON.parse(json ?? "[]"); return Array.isArray(v) ? (v as T[]) : []; } catch { return []; }
};

// The files most likely to hold the plan: named like it (admin, intro,
// Lecture 1, schedule…), else the first slides the course put up.
export function roadmapFiles(all: FileRow[]): FileRow[] {
  const docs = all.filter((f) => /\.(pdf|pptx?|docx?)$/i.test(f.displayName) && !f.hidden);
  const named = docs.filter((f) => f.category === "admin" || ROADMAP_FILE_RE.test(f.displayName));
  const firstSlides = docs.filter((f) => f.category === "slides" || f.category === null)
    .sort((a, b) => a.discoveredAt - b.discoveredAt || a.displayName.localeCompare(b.displayName, undefined, { numeric: true }));
  // Admin decks first, then other plan-like names, oldest first.
  const pick = [...named.sort((a, b) => Number(b.category === "admin") - Number(a.category === "admin") || a.discoveredAt - b.discoveredAt), ...firstSlides];
  return [...new Map(pick.map((f) => [f.id, f])).values()].slice(0, MAX_FILES);
}

// What to read for one module, and a fingerprint that changes when any of it does.
function plan(db: Db, mod: Mod) {
  const fileRows = roadmapFiles(db.select().from(files).where(eq(files.moduleId, mod.id)).all());
  // The welcome announcement and the first few after it set out the term.
  const early = db.select().from(items).where(and(eq(items.moduleId, mod.id), eq(items.type, "announcement"))).all()
    .sort((a, b) => (a.sourceCreatedAt ?? a.firstSeenAt) - (b.sourceCreatedAt ?? b.firstSeenAt)).slice(0, 3);
  const fp = hash({
    v: 3, // bump to re-read every module (v2: pictures; v3: citations by file name)
    syllabus: mod.syllabusBody ? hash(mod.syllabusBody) : null,
    files: fileRows.map((f) => [f.id, f.sizeBytes, f.textSigJson ? hash(f.textSigJson) : null]),
    early: early.map((a) => a.id),
  });
  return { fileRows, early, fp };
}

async function gather(deps: RoadmapDeps, userId: number, mod: Mod, fileRows: FileRow[], early: (typeof items.$inferSelect)[]) {
  const sources: RoadmapSource[] = [];
  const images: RoadmapImage[] = [];
  const refs: SourceRef[] = [];
  if (mod.syllabusBody) {
    const text = htmlToText(mod.syllabusBody).replace(/\n{3,}/g, "\n\n").slice(0, 8000);
    if (text.trim()) { sources.push({ ref: "S", label: "Canvas syllabus page", text }); refs.push({ ref: "S", label: "Syllabus" }); }
  }
  for (const f of fileRows) {
    let text: string | null = null;
    try { text = await deps.fileText(userId, f, mod); } catch { /* unreadable */ }
    if (!text?.trim()) continue;
    const ref = `F${f.id}`;
    sources.push({ ref, label: f.displayName, text: schedulePages(text) });
    refs.push({ ref, label: f.displayName.replace(/\.[^.]+$/, ""), fileId: f.id });
    if (deps.pageImage) {
      for (const page of picturePages(text)) {
        if (images.length >= 4) break;
        let png: Uint8Array | null = null;
        try { png = await deps.pageImage(userId, f, mod, page); } catch { /* not drawable */ }
        if (png?.length) images.push({ ref, label: f.displayName, page, png });
      }
    }
  }
  for (const a of early) {
    const text = htmlToText(a.body).replace(/\s+/g, " ").slice(0, 3000);
    if (!text.trim()) continue;
    const ref = `A${a.id}`;
    sources.push({ ref, label: `Announcement: ${a.title}`, text });
    refs.push({ ref, label: a.title, itemId: a.id });
  }
  return { sources, images, refs };
}

export async function refreshRoadmaps(deps: RoadmapDeps, userId: number, mods: Mod[]): Promise<{ read: number; errors: string[] }> {
  const { db } = deps;
  const cfg = deps.cfgFor(userId);
  const out = { read: 0, errors: [] as string[] };
  if (!cfg) return out;
  const now = deps.now();
  const due = mods.map((mod) => ({ mod, ...plan(db, mod), row: db.select().from(moduleRoadmaps).where(eq(moduleRoadmaps.moduleId, mod.id)).get() }))
    .filter(({ fp, row, fileRows, mod }) => (fileRows.length || mod.syllabusBody)
      && (!row || row.inputsHash !== fp || !row.generatedAt || now - row.generatedAt > REREAD_AFTER)
      && (!row?.errorAt || now - row.errorAt > ERROR_BACKOFF))
    .sort((a, b) => (a.row?.generatedAt ?? 0) - (b.row?.generatedAt ?? 0))
    .slice(0, PER_RUN);
  for (const d of due) {
    try {
      const { sources, images, refs } = await gather(deps, userId, d.mod, d.fileRows, d.early);
      const found = await extractRoadmap(cfg, { code: d.mod.code, name: d.mod.name }, sources, deps.fetchFn, images);
      // Not a failure, but worth knowing: the schedule is a picture this model can't read.
      const note = found.imagesRefused ? `the schedule on ${images.map((i) => `${i.label} p.${i.page}`).join(", ")} is a picture, and this AI model can't read pictures` : null;
      const set = { itemsJson: JSON.stringify(found.items), sourcesJson: JSON.stringify(refs), inputsHash: d.fp, generatedAt: deps.now(), error: note, errorAt: null };
      db.insert(moduleRoadmaps).values({ moduleId: d.mod.id, ...set }).onConflictDoUpdate({ target: moduleRoadmaps.moduleId, set }).run();
      out.read++;
    } catch (err) {
      const e = String(err instanceof Error ? err.message : err).slice(0, 300);
      out.errors.push(`${d.mod.code}: ${e}`);
      db.insert(moduleRoadmaps).values({ moduleId: d.mod.id, error: e, errorAt: deps.now() })
        .onConflictDoUpdate({ target: moduleRoadmaps.moduleId, set: { error: e, errorAt: deps.now() } }).run();
    }
  }
  return out;
}

// --- for the planner ------------------------------------------------------------
const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const sgt = (ms: number) => new Date(ms + SGT);
const dayLabel = (ms: number) => { const d = sgt(ms); return `${WD[d.getUTCDay()]} ${d.getUTCDate()} ${MON[d.getUTCMonth()]}`; };
const hhmm = (ms: number) => sgt(ms).toISOString().slice(11, 16);

export type ClassSlot = { weekday: number; time: string; title: string; count: number };

// The module's weekly Canvas calendar events (its lectures, tutorials and
// labs): a title seen three or more times, at its usual weekday and time.
export function classSlots(rows: { type: string; title: string; dueAt: number | null }[]): ClassSlot[] {
  const by = new Map<string, number[]>();
  for (const r of rows) if (r.type === "event" && r.dueAt !== null) by.set(r.title, [...(by.get(r.title) ?? []), r.dueAt]);
  const out: ClassSlot[] = [];
  for (const [title, times] of by) {
    if (times.length < 3) continue;
    const tally = new Map<string, number>();
    for (const t of times) { const k = `${sgt(t).getUTCDay()}|${hhmm(t)}`; tally.set(k, (tally.get(k) ?? 0) + 1); }
    const [k] = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]!;
    const [weekday, time] = k.split("|");
    out.push({ weekday: Number(weekday), time: time!, title, count: times.length });
  }
  return out.sort((a, b) => a.weekday - b.weekday || a.time.localeCompare(b.time));
}

// "Week 8 = Mon 5 Oct – Sun 11 Oct" for the semester, so the planner can
// place week-numbered items itself.
export function calendarLines(now: number): string[] {
  const { sem, year, weeks } = semesterWeeks(now);
  return [`AY${year} Semester ${sem}:`, ...weeks.map((w) => `${w.label}: ${dayLabel(w.monday)} – ${dayLabel(w.sunday)}`)];
}

// One planner line per roadmap entry, with its date resolved as far as the
// calendar allows: a stated date; else its week, and when it happens in a
// class slot (or the module has exactly one), that slot's day and time.
export function roadmapSignals(db: Db, mod: Mod, now: number): { lines: SignalItem[]; refs: Map<string, TaskSource> } {
  const refs = new Map<string, TaskSource>();
  const row = db.select().from(moduleRoadmaps).where(eq(moduleRoadmaps.moduleId, mod.id)).get();
  if (!row) return { lines: [], refs };
  const found = parseList<RoadmapItem>(row.itemsJson);
  const sources = new Map(parseList<SourceRef>(row.sourcesJson).map((s) => [s.ref, s]));
  const { weeks } = semesterWeeks(now);
  const slots = classSlots(db.select().from(items).where(eq(items.moduleId, mod.id)).all());
  const lines: SignalItem[] = [];
  found.forEach((it, i) => {
    const ref = `M${i + 1}`;
    const src = sources.get(it.ref);
    refs.set(ref, src?.fileId ? { kind: "file", label: `${src.label}${it.page ? ` p.${it.page}` : ""} (course schedule)`, fileId: src.fileId, page: it.page ?? undefined }
      : src?.itemId ? { kind: "announcement", label: `${src.label} (course schedule)`, itemId: src.itemId }
      : { kind: "weightage", label: "Syllabus (course schedule)" });
    const wk = it.week === "recess" ? weeks.find((w) => w.label === "Recess week")
      : it.week === "reading" ? weeks.find((w) => w.label === "Reading week")
      : typeof it.week === "number" ? weeks.find((w) => w.teachingWeek === it.week) : undefined;
    let when = it.date ? `${it.date}${it.time ? ` ${it.time}` : ""} (stated)` : wk ? `${wk.label}, ${dayLabel(wk.monday)} – ${dayLabel(wk.sunday)}` : "no date or week given";
    if (!it.date && wk) {
      const slot = pickSlot(slots, it.slot);
      if (slot) {
        const day = wk.monday + ((slot.weekday + 6) % 7) * D;
        when += ` → in the ${it.slot ?? "class"} slot: ${dayLabel(day)} ${it.time ?? slot.time} (weekly Canvas event "${slot.title}")`;
      }
    }
    if (!it.date && wk && !it.slot && slots.length === 1 && ["quiz", "test", "midterm"].includes(it.kind)) {
      const s = slots[0]!;
      when += ` (the module's only weekly class is ${WD[s.weekday]} ${s.time}, ${dayLabel(wk.monday + ((s.weekday + 6) % 7) * D)} that week)`;
    }
    if (wk && wk.sunday + D < now) return; // long past
    const extra = [it.weightPct != null ? `${it.weightPct}%` : null, it.covers ? `covers ${it.covers}` : null, it.slot && !when.includes("slot") ? `in ${it.slot}` : null].filter(Boolean).join(", ");
    lines.push({ ref, line: `${it.title} (${it.kind}) — ${when}${extra ? ` — ${extra}` : ""}`, body: it.quote ? `"${it.quote}"` : undefined });
  });
  return { lines: lines.slice(0, 30), refs };
}

function pickSlot(slots: ClassSlot[], slot: string | null): ClassSlot | null {
  if (!slots.length) return null;
  if (slot) {
    const kw = /lec/.test(slot) ? /lec/i : /tut/.test(slot) ? /tut/i : /lab/.test(slot) ? /lab/i : null;
    const hit = kw ? slots.filter((s) => kw.test(s.title)) : [];
    if (hit.length === 1) return hit[0]!;
    // A course whose only weekly event is named after the course: that's the class.
    if (slots.length === 1 && /lec|class|seminar|session/.test(slot)) return slots[0]!;
    return null;
  }
  return null;
}

// --- for the calendar --------------------------------------------------------------
// Each schedule entry placed on a day, so the home calendar can show the
// whole semester even before (or without) a task for it: a stated date; else
// its class slot that week; else the week's Friday, marked as "in Week N".
export type RoadmapEntry = {
  moduleId: number; title: string; kind: RoadmapItem["kind"]; at: number; time: string | null;
  placed: "date" | "slot" | "week"; week: string | null; weekFrom: number | null; weekTo: number | null;
  weightPct: number | null; covers: string | null; source: string; fileId: number | null; page: number | null;
};

export function roadmapCalendar(db: Db, mod: Mod, now: number): RoadmapEntry[] {
  const row = db.select().from(moduleRoadmaps).where(eq(moduleRoadmaps.moduleId, mod.id)).get();
  if (!row) return [];
  const found = parseList<RoadmapItem>(row.itemsJson);
  const sources = new Map(parseList<SourceRef>(row.sourcesJson).map((s) => [s.ref, s]));
  const { weeks } = semesterWeeks(now);
  const slots = classSlots(db.select().from(items).where(eq(items.moduleId, mod.id)).all());
  const out: RoadmapEntry[] = [];
  for (const it of found) {
    const src = sources.get(it.ref);
    const wk = it.week === "recess" ? weeks.find((w) => w.label === "Recess week")
      : it.week === "reading" ? weeks.find((w) => w.label === "Reading week")
      : typeof it.week === "number" ? weeks.find((w) => w.teachingWeek === it.week) : undefined;
    let at: number | null = null, time = it.time, placed: RoadmapEntry["placed"] = "week";
    if (it.date) {
      at = Date.parse(`${it.date}T${it.time ?? "23:59"}:00+08:00`);
      placed = "date";
    } else if (wk) {
      const slot = pickSlot(slots, it.slot) ?? (!it.slot && slots.length === 1 && ["quiz", "test", "midterm"].includes(it.kind) ? slots[0]! : null);
      if (slot) {
        time = it.time ?? slot.time;
        at = wk.monday + ((slot.weekday + 6) % 7) * D + Number(time.slice(0, 2)) * H + Number(time.slice(3, 5)) * 60_000;
        placed = "slot";
      } else {
        at = wk.monday + 4 * D + (23 * 60 + 59) * 60_000; // Friday night of that week
      }
    }
    if (at === null || Number.isNaN(at)) continue;
    out.push({
      moduleId: mod.id, title: it.title, kind: it.kind, at, time, placed,
      week: wk?.label ?? null, weekFrom: wk?.monday ?? null, weekTo: wk ? wk.sunday + D - 1 : null,
      weightPct: it.weightPct, covers: it.covers,
      source: src ? `${src.label}${it.page ? ` p.${it.page}` : ""}` : "the course schedule", fileId: src?.fileId ?? null, page: it.page,
    });
  }
  return out;
}

// --- weeks named in announcements ---------------------------------------------
// "Quiz3 - Week 9 - during the class": the week, resolved on the NUS calendar
// and, when the module has one weekly class, to that class's day and time.
// Only "Week N" counts — "covered in W6, W7" is what a quiz covers, not when.
export function weeksNamed(text: string): number[] {
  return [...new Set([...text.matchAll(/\bweek\s*-?\s*(\d{1,2})\b/gi)].map((m) => Number(m[1])).filter((n) => n >= 1 && n <= 13))];
}

export function placeInWeek(week: number, now: number, slots: ClassSlot[]): { at: number; from: number; to: number; inClass: boolean } | null {
  const wk = semesterWeeks(now).weeks.find((w) => w.teachingWeek === week);
  if (!wk) return null;
  const day = (offset: number) => new Date(wk.monday + offset * D + SGT).toISOString().slice(0, 10);
  if (slots.length === 1) {
    const s = slots[0]!;
    return { at: Date.parse(`${day((s.weekday + 6) % 7)}T${s.time}:00+08:00`), from: wk.monday, to: wk.sunday + D, inClass: true };
  }
  return { at: Date.parse(`${day(4)}T23:59:00+08:00`), from: wk.monday, to: wk.sunday + D, inClass: false };
}

// The note added to an announcement for the planner.
export function weekNote(text: string, now: number, slots: ClassSlot[]): string {
  const notes = weeksNamed(text).slice(0, 3).flatMap((n) => {
    const wk = semesterWeeks(now).weeks.find((w) => w.teachingWeek === n);
    if (!wk) return [];
    const p = placeInWeek(n, now, slots);
    return [`Week ${n} = ${dayLabel(wk.monday)} – ${dayLabel(wk.sunday)}${p?.inClass ? `; the module's weekly class that week is ${dayLabel(p.at)} ${hhmm(p.at)}` : ""}`];
  });
  return notes.length ? ` [${notes.join("; ")}]` : "";
}
