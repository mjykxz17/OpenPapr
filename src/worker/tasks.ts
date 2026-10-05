import { createHash } from "node:crypto";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import type { Db } from "../db/client";
import { components, fileHints, files, items, modules, taskChanges, taskFeedback, taskPlans, tasks, users } from "../db/schema";
import { getModuleProfileRow, getNusmods } from "../db/profiles-repo";
import { moduleCodes } from "../connectors/nusmods/client";
import type { CompatConfig } from "../enrich/openai-compat";
import { ModuleProfile } from "../enrich/profiles";
import {
  balanceDays, dailyCap, mergeTasks, obligationLines, planModuleTasks, quizNumber, quizSeries, rollForward, sgtDate,
  type ModuleTaskInput, type SignalItem, type TaskSource, type TaskStep,
} from "../enrich/tasks";
import { htmlToText } from "../lib/html-text";
import { variantGroups } from "../lib/variants";
import type { AssignmentMeta } from "../connectors/canvas/normalize";
import { effectiveComponents } from "./profiles";
import { calendarLines, classSlots, placeInWeek, refreshRoadmaps, roadmapSignals, weekNote, weeksNamed } from "./roadmap";
import { assessmentNumber, KIND_WORD, ownWork, sameAssessment } from "../lib/own-work";
export { ownWork };

const H = 3_600_000;
const D = 24 * H;
export const TASK_TTL = 3 * H;
const ERROR_BACKOFF = 30 * 60_000;
const MODULES_PER_RUN = 3;
const FILES_PER_RUN = 3;
const HINT_CATEGORIES = new Set(["slides", "tutorial", "assignment", "admin", "reading", "other"]);

export type TaskDeps = {
  db: Db;
  now: () => number;
  cfgFor: (userId: number) => CompatConfig | null;
  // The file's text (PDF, or an office file converted to PDF), or null when
  // it cannot be read. Injected so tests need no Canvas.
  fileText: (userId: number, file: typeof files.$inferSelect, mod: typeof modules.$inferSelect) => Promise<string | null>;
  // A page drawn as a PNG (for schedules pasted into slides as pictures).
  pageImage?: (userId: number, file: typeof files.$inferSelect, mod: typeof modules.$inferSelect, page: number) => Promise<Uint8Array | null>;
  fetchFn?: typeof fetch;
};

const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex").slice(0, 32);
const errText = (err: unknown) => String(err instanceof Error ? err.message : err).slice(0, 300);
const parseMeta = <T,>(json: string | null | undefined): T | null => { try { return json ? (JSON.parse(json) as T) : null; } catch { return null; } };
const parseList = <T,>(json: string | null | undefined): T[] => {
  try { const v = JSON.parse(json ?? "[]"); return Array.isArray(v) ? (v as T[]) : []; } catch { return []; }
};
const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const sgtLabel = (ms: number) => {
  const d = new Date(ms + 8 * H);
  return `${d.toISOString().slice(0, 16).replace("T", " ")} (${WEEKDAY[d.getUTCDay()]})`;
};

export function usersWithTaskRequests(db: Db): number[] {
  return db.select({ id: users.id }).from(users).where(isNotNull(users.tasksRequestedAt)).all().map((u) => u.id);
}

// --- reading files for hints --------------------------------------------------
async function harvestHints(deps: TaskDeps, userId: number, mods: (typeof modules.$inferSelect)[]): Promise<number> {
  const { db } = deps;
  const byId = new Map(mods.map((m) => [m.id, m]));
  if (!byId.size) return 0;
  const done = new Set(db.select({ id: fileHints.fileId }).from(fileHints)
    .innerJoin(files, eq(fileHints.fileId, files.id)).where(inArray(files.moduleId, [...byId.keys()])).all().map((r) => r.id));
  const todo = db.select().from(files).where(inArray(files.moduleId, [...byId.keys()])).all()
    // Not yet categorised counts: the categoriser may not have reached it.
    .filter((f) => !done.has(f.id) && (f.category === null || HINT_CATEGORIES.has(f.category)) && /\.(pdf|pptx?|docx?)$/i.test(f.displayName))
    .sort((a, b) => b.discoveredAt - a.discoveredAt)
    .slice(0, FILES_PER_RUN);
  for (const f of todo) {
    let lines: { page: number; text: string }[] = [];
    try {
      const text = await deps.fileText(userId, f, byId.get(f.moduleId)!);
      if (text) lines = obligationLines(text);
    } catch { /* an unreadable file just has no hints */ }
    db.insert(fileHints).values({ fileId: f.id, hintsJson: JSON.stringify(lines), extractedAt: deps.now() })
      .onConflictDoUpdate({ target: fileHints.fileId, set: { hintsJson: JSON.stringify(lines), extractedAt: deps.now() } }).run();
  }
  return todo.length;
}

// --- everything known about one module -----------------------------------------
export function moduleSignals(db: Db, userId: number, mod: typeof modules.$inferSelect, now: number): { input: ModuleTaskInput; refs: Map<string, TaskSource> } {
  const refs = new Map<string, TaskSource>();
  const rows = db.select().from(items).where(and(eq(items.userId, userId), eq(items.moduleId, mod.id))).all();
  const due = (ms: number | null) => (ms === null ? "no due date" : `due ${sgtLabel(ms)}`);

  const byId = new Map(rows.map((r) => [r.id, r]));
  const bySource = new Map(rows.map((r) => [r.sourceId, r]));
  const variants = variantGroups(rows.filter((r) => !r.dismissed));
  const setDone = (ids: number[]) => ids.some((id) => { const r = byId.get(id); return Boolean(r && (r.submitted || r.canvasDone)); });
  const open = rows
    .filter((i) => ["assignment", "event", "deadline"].includes(i.type) && !i.dismissed && !i.submitted && !i.canvasDone && i.category !== "routine"
      && (i.dueAt === null ? i.type === "assignment" : i.dueAt >= now - D && i.dueAt <= now + 60 * D))
    // A per-group set is one line (its first form); done once any is handed in.
    .filter((i) => { const v = variants.get(i.id); return !v || (v.ids[0] === i.id && !setDone(v.ids)); })
    .sort((a, b) => (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity)).slice(0, 25);
  const past = rows
    .filter((i) => ["assignment", "deadline"].includes(i.type) && i.dueAt !== null && i.dueAt < now && i.dueAt >= now - 60 * D)
    .sort((a, b) => b.dueAt! - a.dueAt!).slice(0, 15);
  const canvas: SignalItem[] = open.map((i) => {
    refs.set(`C${i.id}`, { kind: "canvas", label: i.title, itemId: i.id });
    const body = i.type === "assignment" ? htmlToText(i.body).slice(0, 300) : (i.body ?? "").slice(0, 200);
    const q = i.type === "assignment" ? parseMeta<AssignmentMeta>(i.metaJson) : null;
    const origin = i.type === "deadline" ? (i.sourceId.startsWith("page_todo:") ? "Canvas planner (page to read)" : "From an announcement") : i.type === "event" ? "Calendar"
      : q?.practice ? (/survey|questionnaire|feedback/i.test(i.title) ? "Canvas survey" : "Canvas practice quiz (ungraded)") : q?.quiz ? "Canvas quiz" : "Canvas";
    const when = q?.closesOnly ? `closes ${sgtLabel(i.dueAt!)}` : due(i.dueAt);
    const set = variants.get(i.id);
    if (set) return { ref: `C${i.id}`, line: `Canvas: ${set.stem} — ${when} — posted ${set.ids.length} times, once per tutorial group; the student hands in only their own. ONE task.` };
    const opens = q?.opensAt && q.opensAt > now ? `, opens ${sgtLabel(q.opensAt)}` : "";
    return { ref: `C${i.id}`, line: `${origin}: ${i.title} — ${when}${opens}${i.missing ? " — Canvas marks this MISSING" : ""}`, body: body || undefined };
  });
  const pastRows: SignalItem[] = past.map((i) => {
    refs.set(`C${i.id}`, { kind: "canvas", label: i.title, itemId: i.id });
    return { ref: `C${i.id}`, line: `${i.title} — ${due(i.dueAt)}${i.submitted ? " (submitted)" : ""}` };
  });
  const series = quizSeries(rows.filter((r) => r.type === "assignment" && !r.dismissed), now);
  if (series) {
    const lastRow = byId.get(series.lastId)!;
    refs.set(`C${lastRow.id}`, { kind: "canvas", label: lastRow.title, itemId: lastRow.id });
    pastRows.unshift({ ref: `C${lastRow.id}`, line: `PATTERN: ${series.seen} numbered quizzes on Canvas so far${series.everyDays ? `, about every ${series.everyDays} days` : ""}${series.lastDue ? `, the last ${sgtLabel(series.lastDue)}` : ""}. Quiz ${series.next} is not on Canvas yet — plan it as an anticipated quiz task unless the course says the quizzes are over.` });
  }

  // Announcements and what lecturers or TAs said in discussions read the same
  // way: the course telling the student something.
  const weeklyClasses = classSlots(rows);
  const announcements: SignalItem[] = rows
    .filter((i) => (i.type === "announcement" || i.type === "staff_reply") && (i.sourceCreatedAt ?? i.firstSeenAt) >= now - 45 * D)
    .sort((a, b) => (b.sourceCreatedAt ?? b.firstSeenAt) - (a.sourceCreatedAt ?? a.firstSeenAt)).slice(0, 14)
    .map((i) => {
      const posted = sgtLabel(i.sourceCreatedAt ?? i.firstSeenAt);
      const text = htmlToText(i.body).replace(/\s+/g, " ");
      if (i.type === "staff_reply") {
        const meta = parseMeta<{ topicSourceId: string; topicTitle: string }>(i.metaJson);
        const topic = meta ? bySource.get(meta.topicSourceId) : undefined;
        refs.set(`R${i.id}`, { kind: "discussion", label: `${i.sender ?? "Staff"} in “${meta?.topicTitle ?? i.title}”`, itemId: topic?.id ?? i.id });
        return { ref: `R${i.id}`, line: `${i.sender ?? "A lecturer"} replied in the discussion “${meta?.topicTitle ?? i.title}” (${posted})`, body: text.slice(0, 600) };
      }
      refs.set(`A${i.id}`, { kind: "announcement", label: i.title, itemId: i.id });
      return { ref: `A${i.id}`, line: `${i.title} (posted ${posted})${weekNote(`${i.title} ${text}`, now, weeklyClasses)}`, body: text.slice(0, 1200) };
    });

  // Discussions that ask something of the student: graded, "post first", or
  // given a date. Whether they have posted decides whether it is still to do.
  const discussions: SignalItem[] = rows
    .filter((i) => i.type === "discussion" && !i.dismissed)
    .map((i) => ({ i, meta: parseMeta<{ graded: boolean; requireInitialPost: boolean; posted: boolean; replies: number; locked: boolean; assignmentId: number | null }>(i.metaJson) }))
    .filter(({ i, meta }) => meta && !meta.locked && (meta.graded || meta.requireInitialPost || i.dueAt !== null) && (i.dueAt === null || i.dueAt >= now - D))
    .slice(0, 10)
    .map(({ i, meta }) => {
      refs.set(`D${i.id}`, { kind: "discussion", label: i.title, itemId: i.id });
      const graded = meta!.assignmentId ? bySource.get(`assignment:${meta!.assignmentId}`) : undefined;
      if (graded) refs.set(`C${graded.id}`, refs.get(`C${graded.id}`) ?? { kind: "canvas", label: graded.title, itemId: graded.id });
      const flags = [meta!.graded ? `graded${graded ? ` (same as [C${graded.id}])` : ""}` : "ungraded", meta!.requireInitialPost ? "must post before seeing replies" : null,
        meta!.posted || i.canvasDone ? "you HAVE posted" : "you have NOT posted", `${meta!.replies} replies`].filter(Boolean).join(", ");
      return { ref: `D${i.id}`, line: `Discussion: ${i.title} — ${due(i.dueAt)} — ${flags}`, body: htmlToText(i.body).replace(/\s+/g, " ").slice(0, 400) || undefined };
    });

  // The student's own notes in the Canvas planner are things they meant to do.
  const notes: SignalItem[] = rows
    .filter((i) => i.type === "planner_note" && !i.dismissed && !i.canvasDone && (i.dueAt === null || i.dueAt >= now - D))
    .slice(0, 10)
    .map((i) => {
      refs.set(`P${i.id}`, { kind: "planner", label: `Your note: ${i.title}`, itemId: i.id });
      return { ref: `P${i.id}`, line: `Your own Canvas planner note: ${i.title} — ${due(i.dueAt)}`, body: (i.body ?? "").slice(0, 300) || undefined };
    });
  void byId;

  const hintRows = db.select({ file: files, hints: fileHints.hintsJson }).from(fileHints)
    .innerJoin(files, eq(fileHints.fileId, files.id)).where(eq(files.moduleId, mod.id)).all()
    .sort((a, b) => b.file.discoveredAt - a.file.discoveredAt);
  const fileLines: SignalItem[] = [];
  for (const { file, hints } of hintRows) {
    const stem = file.displayName.replace(/\.[^.]+$/, "");
    for (const h of parseList<{ page: number; text: string }>(hints)) {
      if (fileLines.length >= 30) break;
      const ref = `F${file.id}p${h.page}`;
      refs.set(ref, { kind: "file", label: `${stem} p.${h.page}`, fileId: file.id, page: h.page });
      fileLines.push({ ref, line: `${file.displayName} p.${h.page}: ${h.text}` });
    }
  }

  refs.set("W", { kind: "weightage", label: "Assessment weightage" });
  const weightage = effectiveComponents(db.select().from(components).where(eq(components.moduleId, mod.id)).all());

  let examDate: string | null = null;
  for (const code of moduleCodes(mod.code)) {
    const nm = getNusmods(db, code)?.module;
    const upcoming = (nm?.examDates ?? []).map((d) => Date.parse(d)).filter((t) => !Number.isNaN(t) && t >= now - D && t <= now + 200 * D).sort((a, b) => a - b);
    if (upcoming.length) { examDate = sgtLabel(upcoming[0]); break; }
  }
  if (examDate) refs.set("X", { kind: "nusmods", label: "Final exam (NUSMods)" });

  let studyAdvice: string[] = [];
  try {
    const p = ModuleProfile.safeParse(JSON.parse(getModuleProfileRow(db, mod.id)?.profileJson ?? "null"));
    if (p.success) studyAdvice = [...p.data.howToStudy, ...p.data.fit.gaps.map((g) => `gap: ${g}`)].slice(0, 7);
  } catch { /* no profile yet */ }

  // A date the student set is theirs — unless the course has announced
  // something about that assessment since. Then the planner sees the date as
  // an ordinary one, without the student's old correction, and the
  // announcement decides.
  const reopened = new Set<string>();
  const existingRows = db.select().from(tasks).where(and(eq(tasks.userId, userId), eq(tasks.moduleId, mod.id))).all();
  for (const t of existingRows) {
    if (t.dueLocked && announcedSince(t.title, t.dueLockedAt ?? t.touchedAt ?? 0, rows)) reopened.add(t.title);
  }
  const existing = existingRows.map((t) => {
    const steps = parseList<TaskStep>(t.stepsJson);
    const lockedNote = t.dueLocked && !reopened.has(t.title) ? `, set by the student${t.dueLockedAt ? ` on ${sgtLabel(t.dueLockedAt)}` : ""}` : "";
    return {
      key: t.key, title: t.title,
      due: t.dueAt === null ? null : `${sgtLabel(t.dueAt)}${lockedNote}${reopened.has(t.title) ? " — the course has announced a change since; use the announcement" : ""}`,
      progress: t.status === "open" ? `${steps.filter((s) => s.done).length}/${steps.length} steps done`
        : t.status === "dismissed" ? "dismissed by the student" : t.status,
    };
  });
  const feedback = db.select().from(taskFeedback).where(and(eq(taskFeedback.userId, userId), eq(taskFeedback.moduleId, mod.id))).all()
    // A date correction the course has since announced over is out of date.
    .filter((f) => !(f.kind === "wrong_date" && announcedSince(f.title, f.createdAt, rows)))
    .sort((a, b) => b.createdAt - a.createdAt).slice(0, 15)
    .map((f) => (f.kind === "not_task" ? `"${f.title}" is NOT a real task — do not plan it` : `"${f.title}": wrong date — ${f.note ?? "the student set it"} (said ${sgtLabel(f.createdAt)})`));

  const road = roadmapSignals(db, mod, now);
  for (const [k, v] of road.refs) refs.set(k, v);
  const slots = classSlots(rows).map((s) => `${WEEKDAY[s.weekday]} ${s.time} — "${s.title}" (${s.count} on the calendar)`);

  const d = new Date(now + 8 * H);
  return {
    refs,
    input: {
      today: `${sgtDate(now)} (${WEEKDAY[d.getUTCDay()]})`,
      module: { code: mod.code, name: mod.name },
      canvas, past: pastRows, announcements, discussions, notes, fileHints: fileLines, weightage, examDate, studyAdvice, existing, feedback,
      roadmap: road.lines, calendar: calendarLines(now), classSlots: slots,
    },
  };
}

// An announcement or staff reply posted after `since` that names this
// assessment ("Quiz-3 in Week 9", "Quiz3 - Week 9 - during the class").
export { sameAssessment };
export function announcedSince(title: string, since: number, rows: { type: string; title: string; body: string | null; sourceCreatedAt: number | null; firstSeenAt: number }[]): boolean {
  const kind = KIND_WORD.exec(title)?.[1]?.toLowerCase();
  const n = assessmentNumber(title);
  if (!kind || n === null) return false;
  const re = new RegExp(`\\b${kind}[\\s_-]*0?${n}\\b`, "i");
  return rows.some((i) => (i.type === "announcement" || i.type === "staff_reply") && (i.sourceCreatedAt ?? i.firstSeenAt) > since
    && (re.test(i.title) || re.test(htmlToText(i.body ?? ""))));
}

// The planner sometimes counts weeks wrong. When the newest announcement it
// cites for an assessment names it and exactly one "Week N", the date must
// fall in that week: if it doesn't, it goes to the module's weekly class that
// week (or the week's Friday).
export function fitAnnouncedWeeks<T extends { title: string; dueAt: number | null; dueConfidence: "exact" | "estimated"; sources: TaskSource[] }>(db: Db, moduleId: number, planned: T[], now: number): T[] {
  const rows = db.select().from(items).where(eq(items.moduleId, moduleId)).all();
  const byId = new Map(rows.map((r) => [r.id, r]));
  const slots = classSlots(rows);
  return planned.map((t) => {
    const anns = t.sources.filter((x) => x.kind === "announcement" && x.itemId != null).map((x) => byId.get(x.itemId!)).filter((r) => r !== undefined)
      .sort((a, b) => (b.sourceCreatedAt ?? b.firstSeenAt) - (a.sourceCreatedAt ?? a.firstSeenAt));
    const a = anns[0];
    if (!a) return t;
    const text = `${a.title} ${htmlToText(a.body ?? "")}`;
    const weeks = weeksNamed(text);
    if (weeks.length !== 1 || !announcedSince(t.title, -1, [a])) return t;
    const p = placeInWeek(weeks[0]!, now, slots);
    if (!p || (t.dueAt !== null && t.dueAt >= p.from && t.dueAt < p.to)) return t;
    return { ...t, dueAt: p.at, dueConfidence: p.inClass ? t.dueConfidence : "estimated" };
  });
}

// --- writing a module's plan ----------------------------------------------------
export function applyPlan(db: Db, userId: number, moduleId: number, plannedIn: Awaited<ReturnType<typeof planModuleTasks>>, now: number) {
  const current = db.select().from(tasks).where(and(eq(tasks.userId, userId), eq(tasks.moduleId, moduleId))).all();
  // The planner sometimes names a new key for an assessment it already has
  // ("cs4238-quiz-3" next to "cs4238-series-quiz-3"). Same kind and number is
  // the same task: it keeps the existing one, with the student's progress.
  const existingKeys = new Set(current.map((t) => t.key));
  const claimed = new Set(plannedIn.map((p) => p.key).filter((k) => existingKeys.has(k)));
  const planned = plannedIn.map((p) => {
    if (existingKeys.has(p.key)) return p;
    const twin = current.find((t) => t.status !== "dismissed" && !claimed.has(t.key) && !t.key.startsWith("manual-") && sameAssessment(t.title, p.title));
    if (!twin) return p;
    claimed.add(twin.key);
    return { ...p, key: twin.key };
  });
  // A key the planner reused from another module stays with that module.
  const elsewhere = new Set(db.select({ key: tasks.key, moduleId: tasks.moduleId }).from(tasks).where(eq(tasks.userId, userId)).all()
    .filter((t) => t.moduleId !== moduleId).map((t) => t.key));
  const ops = mergeTasks(
    current.map((t) => ({ id: t.id, key: t.key, status: t.status, touchedAt: t.touchedAt, steps: parseList<TaskStep>(t.stepsJson) })),
    planned.filter((t) => !elsewhere.has(t.key) && !t.key.startsWith("manual-")),
  );
  const locked = new Set(current.filter((t) => t.dueLocked).map((t) => t.id));
  const renamed = new Set(current.filter((t) => t.titleLocked).map((t) => t.id));
  // A safety-net task goes only once the plan covers its Canvas item.
  const citedNow = new Set(planned.flatMap((t) => t.sources.map((x) => x.itemId).filter((x): x is number => x != null)));
  const byIdNow = new Map(current.map((t) => [t.id, t]));
  const plannedBefore = Boolean(db.select().from(taskPlans).where(eq(taskPlans.moduleId, moduleId)).get()?.generatedAt);
  // The newest announcement or staff reply a planned task cites.
  const newestNews = (sources: TaskSource[]) => sources.filter((x) => (x.kind === "announcement" || x.kind === "discussion") && x.itemId != null)
    .sort((a, b) => (postedAt.get(b.itemId!) ?? 0) - (postedAt.get(a.itemId!) ?? 0))[0] ?? null;
  // When each cited announcement or staff reply was posted.
  const citedIds = [...citedNow];
  const postedAt = new Map(citedIds.length
    ? db.select({ id: items.id, at: items.sourceCreatedAt, seen: items.firstSeenAt }).from(items).where(and(eq(items.userId, userId), inArray(items.id, citedIds))).all().map((i) => [i.id, i.at ?? i.seen])
    : []);
  ops.remove = ops.remove.filter((id) => {
    const t = byIdNow.get(id)!;
    if (t.key.includes("-series-quiz-")) return planned.some((p) => p.kind === "quiz" && (p.dueAt === null || p.dueAt > now));
    if (!t.key.includes("-canvas-")) return true;
    return parseList<TaskSource>(t.sourcesJson).some((x) => x.itemId != null && citedNow.has(x.itemId));
  });
  db.transaction((tx) => {
    for (const t of ops.insert) {
      const row = tx.insert(tasks).values({
        userId, moduleId, key: t.key, title: t.title, kind: t.kind, dueAt: t.dueAt, dueConfidence: t.dueConfidence,
        anticipated: t.anticipated, weightPct: t.weightPct, why: t.why, sourcesJson: JSON.stringify(t.sources),
        stepsJson: JSON.stringify(t.steps), status: "open", createdAt: now, updatedAt: now,
      }).returning({ id: tasks.id }).get();
      // Work found after the module's first plan goes in the bell; the first
      // plan itself would only flood it.
      if (plannedBefore && row && t.sources.some((x) => x.kind === "announcement" || x.kind === "discussion" || ((x.kind === "canvas" || x.kind === "planner") && x.itemId != null))) {
        const src = newestNews(t.sources) ?? t.sources[0];
        tx.insert(taskChanges).values({ userId, moduleId, taskId: row.id, kind: "task_added", title: t.title, newDueAt: t.dueAt, newConfidence: t.dueConfidence,
          sourceItemId: src?.itemId ?? null, sourceLabel: src?.label ?? null, quote: src?.quote ?? null, createdAt: now }).run();
      }
    }
    for (const u of ops.update) {
      const t = u.task;
      const was = byIdNow.get(u.id)!;
      const moved = t.dueAt !== null && was.dueAt !== null && Math.abs(t.dueAt - was.dueAt) >= 12 * 3_600_000;
      const news = newestNews(t.sources);
      // A date the student set stays theirs. When the course announces a
      // different one after they set it ("Quiz 3 moved to Week 9"), the bell
      // asks them; nothing moves until they choose.
      if (locked.has(u.id) && t.dueAt !== null && t.dueAt !== was.dueAt && news && (postedAt.get(news.itemId!) ?? 0) > (was.dueLockedAt ?? was.touchedAt ?? 0)) {
        const open = tx.select().from(taskChanges).where(and(eq(taskChanges.taskId, u.id), eq(taskChanges.kind, "date_proposed"))).all();
        const asked = open.find((c) => c.sourceItemId === news.itemId && (c.status === "kept" || (c.status === "pending" && c.newDueAt === t.dueAt)));
        if (!asked) {
          const pending = open.find((c) => c.status === "pending");
          const values = { title: was.title, oldDueAt: was.dueAt, newDueAt: t.dueAt, newConfidence: t.dueConfidence, sourceItemId: news.itemId!, sourceLabel: news.label, quote: news.quote ?? null };
          if (pending) tx.update(taskChanges).set({ ...values, createdAt: now }).where(eq(taskChanges.id, pending.id)).run();
          else tx.insert(taskChanges).values({ userId, moduleId, taskId: u.id, kind: "date_proposed", ...values, createdAt: now }).run();
        }
      } else if (!locked.has(u.id) && moved && news && !parseList<TaskSource>(was.sourcesJson).some((x) => x.itemId === news.itemId)) {
        // Moved for them because of something new the course posted: shown in
        // the bell with an undo.
        tx.insert(taskChanges).values({ userId, moduleId, taskId: u.id, kind: "date_moved", title: t.title, oldDueAt: was.dueAt, newDueAt: t.dueAt, newConfidence: t.dueConfidence,
          sourceItemId: news.itemId!, sourceLabel: news.label, quote: news.quote ?? null, createdAt: now }).run();
      }
      const date = locked.has(u.id) ? {} : { dueAt: t.dueAt, dueConfidence: t.dueConfidence };
      tx.update(tasks).set({
        // A title or type the student changed stays theirs too.
        ...(renamed.has(u.id) ? {} : { title: t.title, kind: t.kind }), ...date, anticipated: t.anticipated,
        weightPct: t.weightPct, why: t.why, sourcesJson: JSON.stringify(t.sources), updatedAt: now,
        ...(u.keepSteps ? {} : { stepsJson: JSON.stringify(t.steps) }),
      }).where(eq(tasks.id, u.id)).run();
    }
    if (ops.remove.length) tx.delete(tasks).where(inArray(tasks.id, ops.remove)).run();
  });
  return ops;
}

// Tasks whose Canvas work has all been submitted are done; steps the student
// did not get to move forward; no day is loaded past what is doable.
export function tidyTasks(db: Db, userId: number, now: number): number {
  reopenPatternDone(db, userId, now);
  const open = db.select().from(tasks).where(and(eq(tasks.userId, userId), eq(tasks.status, "open"))).all();
  if (!open.length) return 0;
  const cited = open.flatMap((t) => parseList<TaskSource>(t.sourcesJson).filter((s) => (s.kind === "canvas" || s.kind === "discussion" || s.kind === "planner") && s.itemId).map((s) => s.itemId!));
  const citedRows = new Map(cited.length
    ? db.select().from(items).where(inArray(items.id, cited)).all().map((r) => [r.id, r])
    : []);
  // What counts as finishing: submitted on Canvas, ticked off in the Canvas
  // planner, or posted in a discussion that asked for a post. A discussion
  // cited only for what a lecturer said in it does not count.
  const obligation = (id: number) => {
    const r = citedRows.get(id);
    if (!r) return false;
    if (r.type !== "discussion") return true;
    const m = parseMeta<{ graded: boolean; requireInitialPost: boolean }>(r.metaJson);
    return Boolean(m?.graded || m?.requireInitialPost || r.dueAt !== null);
  };
  const setOf = new Map<number, number[]>();
  if (open.some((t) => t.key.includes("-canvas-set-"))) {
    const all = db.select().from(items).where(and(eq(items.userId, userId), eq(items.type, "assignment"))).all();
    const vg = variantGroups(all.filter((r) => !r.dismissed));
    const done = new Set(all.filter((r) => r.submitted || r.canvasDone).map((r) => r.id));
    for (const [id, g] of vg) if (g.ids.some((x) => done.has(x))) setOf.set(id, g.ids);
  }
  const finished = (id: number) => { const r = citedRows.get(id); return Boolean(r && (r.submitted || r.canvasDone)) || setOf.has(id); };
  const today = sgtDate(now);
  let changed = 0;
  const live: { id: number; key: string; dueAt: number | null; steps: TaskStep[]; before: string }[] = [];
  for (const t of open) {
    const srcs = parseList<TaskSource>(t.sourcesJson).filter((s) => (s.kind === "canvas" || s.kind === "discussion" || s.kind === "planner") && s.itemId && obligation(s.itemId)
      && ownWork(t.title, citedRows.get(s.itemId)!.title, t.dueAt, citedRows.get(s.itemId)!.dueAt));
    const workIds = srcs.map((s) => s.itemId!);
    const onlyPosts = srcs.length > 0 && srcs.every((s) => s.kind !== "canvas");
    // An anticipated task cites past work only as the pattern it follows.
    if (!t.anticipated && workIds.length && workIds.every(finished) && (onlyPosts || ["submission", "quiz", "project", "presentation", "admin"].includes(t.kind))) {
      db.update(tasks).set({ status: "done", updatedAt: now }).where(eq(tasks.id, t.id)).run();
      changed++;
      continue;
    }
    // Long past its date and never touched: it is not going to happen.
    if (t.dueAt !== null && t.dueAt < now - 3 * D && t.touchedAt === null) {
      db.update(tasks).set({ status: "dismissed", updatedAt: now }).where(eq(tasks.id, t.id)).run();
      changed++;
      continue;
    }
    const steps = parseList<TaskStep>(t.stepsJson);
    live.push({ id: t.id, key: t.key, dueAt: t.dueAt, steps: t.dueAt !== null && t.dueAt < now ? steps : rollForward(steps, today, t.dueAt), before: t.stepsJson });
  }
  balanceDays(live, today, dailyCap);
  for (const t of live) {
    const after = JSON.stringify(t.steps);
    if (after !== t.before) { db.update(tasks).set({ stepsJson: after }).where(eq(tasks.id, t.id)).run(); changed++; }
  }
  return changed;
}

// Undo the old mistake ownWork now prevents: a future task closed only
// because the earlier item it cited as a pattern was submitted, with none of
// its own steps ticked. Reopened once; a task the student closes stays closed.
function reopenPatternDone(db: Db, userId: number, now: number): void {
  const done = db.select().from(tasks).where(and(eq(tasks.userId, userId), eq(tasks.status, "done"))).all()
    // Closed by the app, not the student: marking done touches the task in
    // the same moment, an automatic close only updates it.
    .filter((t) => t.dueAt !== null && t.dueAt > now && !parseList<TaskStep>(t.stepsJson).some((s) => s.done)
      && (t.touchedAt === null || t.touchedAt < t.updatedAt - 1000));
  if (!done.length) return;
  const ids = done.flatMap((t) => parseList<TaskSource>(t.sourcesJson).map((s) => s.itemId).filter((x): x is number => x != null));
  const rows = new Map(ids.length ? db.select().from(items).where(inArray(items.id, ids)).all().map((r) => [r.id, r]) : []);
  for (const t of done) {
    const canvas = parseList<TaskSource>(t.sourcesJson).filter((s) => s.kind === "canvas" && s.itemId && rows.has(s.itemId));
    if (canvas.length && canvas.every((s) => !ownWork(t.title, rows.get(s.itemId!)!.title, t.dueAt, rows.get(s.itemId!)!.dueAt))) {
      db.update(tasks).set({ status: "open", updatedAt: now }).where(eq(tasks.id, t.id)).run();
    }
  }
}

const guessKind = (title: string) =>
  /quiz/i.test(title) ? "quiz" : /exam|mid-?term|\btest\b/i.test(title) ? "exam" : /project|milestone/i.test(title) ? "project"
    : /present/i.test(title) ? "presentation" : /^read|reading/i.test(title) ? "reading" : "submission";

// The safety net. Whatever Canvas says is due soon — an assignment, a quiz, a
// graded discussion, a page with a "read by" date, a planner note — becomes a
// task if no task cites it yet, even with no model to plan it. The planner
// adopts it (same key) on its next run and adds steps.
export function ensureCanvasCovered(db: Db, userId: number, now: number): number {
  const mods = new Map(db.select().from(modules).where(and(eq(modules.userId, userId), eq(modules.active, true), eq(modules.hidden, false))).all().map((m) => [m.id, m]));
  const all = db.select().from(tasks).where(eq(tasks.userId, userId)).all();
  const covered = new Set(all.flatMap((t) => parseList<TaskSource>(t.sourcesJson).map((s) => s.itemId).filter((x): x is number => x != null)));
  const keys = new Set(all.map((t) => t.key));
  const rows = db.select().from(items).where(eq(items.userId, userId)).all();
  // A graded discussion and its assignment are one piece of work.
  const gradedDiscussion = new Map<string, typeof rows[number]>();
  for (const r of rows) if (r.type === "discussion") {
    const m = parseMeta<{ assignmentId: number | null }>(r.metaJson);
    if (m?.assignmentId) gradedDiscussion.set(`assignment:${m.assignmentId}`, r);
  }
  const variants = variantGroups(rows.filter((r) => !r.dismissed));
  const rowById = new Map(rows.map((r) => [r.id, r]));
  // Per-form tasks this net made before sets were understood.
  const oldForms = all.filter((t) => t.status === "open" && t.touchedAt === null && /-canvas-\d+$/.test(t.key) && variants.has(Number(t.key.split("-canvas-")[1])));
  if (oldForms.length) {
    db.delete(tasks).where(inArray(tasks.id, oldForms.map((t) => t.id))).run();
    for (const t of oldForms) { keys.delete(t.key); for (const s of parseList<TaskSource>(t.sourcesJson)) if (s.itemId != null) covered.delete(s.itemId); }
  }
  let added = 0;
  for (const r of rows) {
    const set = variants.get(r.id);
    if (set) {
      // Old per-form tasks the student dismissed were clearing noise, not the set.
      const coveredBySet = new Set(all.filter((t) => !oldForms.includes(t) && !(t.status === "dismissed" && /-canvas-\d+$/.test(t.key)))
        .flatMap((t) => parseList<TaskSource>(t.sourcesJson).map((s) => s.itemId)));
      if (set.ids[0] !== r.id || set.ids.some((id) => coveredBySet.has(id))) continue;
      if (set.ids.some((id) => { const x = rowById.get(id); return Boolean(x && (x.submitted || x.canvasDone)); })) continue;
    }
    const eligible = (r.type === "assignment" || r.type === "planner_note" || (r.type === "deadline" && r.sourceId.startsWith("page_todo:")))
      && !r.dismissed && !r.submitted && !r.canvasDone && r.dueAt !== null && r.dueAt >= now - D && r.dueAt <= now + 14 * D
      && (r.moduleId === null ? r.type === "planner_note" : mods.has(r.moduleId));
    if (!eligible || (!set && covered.has(r.id))) continue;
    const pair = gradedDiscussion.get(r.sourceId);
    if (pair && (covered.has(pair.id) || pair.submitted)) continue;
    const code = r.moduleId ? mods.get(r.moduleId)!.code : "note";
    const key = set ? `${code.toLowerCase()}-canvas-set-${r.id}` : `${code.toLowerCase()}-canvas-${r.id}`;
    if (keys.has(key)) continue;
    const sources: TaskSource[] = [{ kind: r.type === "planner_note" ? "planner" : "canvas", label: r.type === "planner_note" ? `Your note: ${r.title}` : set ? `${set.stem} — ${set.ids.length} on Canvas, one per group` : r.title, itemId: r.id }];
    if (pair) sources.push({ kind: "discussion", label: pair.title, itemId: pair.id });
    db.insert(tasks).values({
      userId, moduleId: r.moduleId, key, title: set ? `${set.stem} (your group's)`.slice(0, 80) : r.title.slice(0, 80),
      kind: r.type === "planner_note" ? "admin" : r.type === "deadline" ? "reading" : pair ? "submission"
        : parseMeta<AssignmentMeta>(r.metaJson)?.quiz ? "quiz" : guessKind(r.title),
      dueAt: r.dueAt, dueConfidence: "exact", anticipated: false,
      why: set ? `Canvas lists ${set.ids.length}, one per tutorial group — hand in only yours` : r.missing ? "Canvas marks this as missing" : null,
      sourcesJson: JSON.stringify(sources), stepsJson: "[]", status: "open", createdAt: now, updatedAt: now,
    }).onConflictDoNothing().run();
    keys.add(key);
    added++;
  }
  return added;
}

// The next quiz of a running series (see quizSeries), when no upcoming quiz
// task covers the module. It gives way once the real quiz is on Canvas.
export function ensureQuizSeries(db: Db, userId: number, now: number): number {
  const mods = db.select().from(modules).where(and(eq(modules.userId, userId), eq(modules.active, true), eq(modules.hidden, false))).all();
  const all = db.select().from(tasks).where(eq(tasks.userId, userId)).all();
  const keys = new Set(all.map((t) => t.key));
  let changed = 0;
  for (const mod of mods) {
    const rows = db.select().from(items).where(and(eq(items.userId, userId), eq(items.moduleId, mod.id), eq(items.type, "assignment"))).all().filter((r) => !r.dismissed);
    const onCanvas = new Set(rows.map((r) => quizNumber(r.title)).filter((n): n is number => n !== null));
    const mine = all.filter((t) => t.moduleId === mod.id && t.status === "open");
    // The real quiz arrived: the placeholder steps aside for its Canvas task.
    for (const t of mine) {
      const m = /-series-quiz-(\d+)$/.exec(t.key);
      if (m && onCanvas.has(Number(m[1]))) {
        db.update(tasks).set({ status: "dismissed", updatedAt: now }).where(eq(tasks.id, t.id)).run();
        changed++;
      }
    }
    const s = quizSeries(rows, now);
    if (!s) continue;
    const key = `${mod.code.toLowerCase()}-series-quiz-${s.next}`;
    if (keys.has(key)) continue;   // made before; dismissed or done stays that way
    if (mine.some((t) => t.kind === "quiz" && !t.key.includes("-series-quiz-") && (t.dueAt === null || t.dueAt > now))) continue;
    const last = rows.find((r) => r.id === s.lastId)!;
    db.insert(tasks).values({
      userId, moduleId: mod.id, key, title: `Quiz ${s.next} (expected)`, kind: "quiz",
      dueAt: s.estimate, dueConfidence: "estimated", anticipated: true, weightPct: null,
      why: `${s.seen} quizzes so far${s.everyDays ? `, about every ${s.everyDays} days` : ""}; the next isn't on Canvas yet`,
      sourcesJson: JSON.stringify([{ kind: "canvas", label: `${last.title} — the last one`, itemId: last.id }]),
      stepsJson: "[]", status: "open", createdAt: now, updatedAt: now,
    }).onConflictDoNothing().run();
    keys.add(key);
    changed++;
  }
  return changed;
}

export type TaskRefreshResult = { files: number; planned: number; errors: string[] };

export async function refreshTasks(deps: TaskDeps, userId: number): Promise<TaskRefreshResult> {
  const { db } = deps;
  const out: TaskRefreshResult = { files: 0, planned: 0, errors: [] };
  const user = db.select().from(users).where(eq(users.id, userId)).get();
  if (!user) return out;
  const requested = user.tasksRequestedAt !== null;
  const mods = db.select().from(modules).where(and(eq(modules.userId, userId), eq(modules.active, true), eq(modules.hidden, false))).all();

  out.files = await harvestHints(deps, userId, mods);
  // The course's own schedule first: the plan below works from it.
  const road = await refreshRoadmaps(deps, userId, mods);
  out.errors.push(...road.errors.map((e) => `roadmap ${e}`));

  const cfg = deps.cfgFor(userId);
  if (cfg) {
    const plans = new Map(db.select().from(taskPlans).where(inArray(taskPlans.moduleId, mods.map((m) => m.id).concat(-1))).all().map((p) => [p.moduleId, p]));
    const now = deps.now();
    const candidates = mods.map((mod) => {
      const { input, refs } = moduleSignals(db, userId, mod, now);
      return { mod, input, refs, h: hash(input), plan: plans.get(mod.id) };
    }).filter((c) => requested || (c.plan?.inputsHash !== c.h
      && (!c.plan?.generatedAt || now - c.plan.generatedAt > TASK_TTL)
      && (!c.plan?.errorAt || now - c.plan.errorAt > ERROR_BACKOFF)))
      .sort((a, b) => (a.plan?.generatedAt ?? 0) - (b.plan?.generatedAt ?? 0));
    for (const c of requested ? candidates : candidates.slice(0, MODULES_PER_RUN)) {
      try {
        const planned = fitAnnouncedWeeks(db, c.mod.id, await planModuleTasks(cfg, c.input, c.refs, deps.now(), deps.fetchFn), deps.now());
        applyPlan(db, userId, c.mod.id, planned, deps.now());
        db.insert(taskPlans).values({ moduleId: c.mod.id, inputsHash: c.h, generatedAt: deps.now(), error: null, errorAt: null })
          .onConflictDoUpdate({ target: taskPlans.moduleId, set: { inputsHash: c.h, generatedAt: deps.now(), error: null, errorAt: null } }).run();
        out.planned++;
      } catch (err) {
        const e = errText(err);
        out.errors.push(`${c.mod.code}: ${e}`);
        db.insert(taskPlans).values({ moduleId: c.mod.id, error: e, errorAt: deps.now() })
          .onConflictDoUpdate({ target: taskPlans.moduleId, set: { error: e, errorAt: deps.now() } }).run();
      }
    }
  }

  ensureCanvasCovered(db, userId, deps.now());
  ensureQuizSeries(db, userId, deps.now());
  tidyTasks(db, userId, deps.now());
  if (requested) db.update(users).set({ tasksRequestedAt: null }).where(eq(users.id, userId)).run();
  return out;
}
