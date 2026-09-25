import { createHash } from "node:crypto";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import type { Db } from "../db/client";
import { components, fileHints, files, items, modules, taskPlans, tasks, users } from "../db/schema";
import { getModuleProfileRow, getNusmods } from "../db/profiles-repo";
import { moduleCodes } from "../connectors/nusmods/client";
import type { CompatConfig } from "../enrich/openai-compat";
import { ModuleProfile } from "../enrich/profiles";
import {
  balanceDays, dailyCap, mergeTasks, obligationLines, planModuleTasks, rollForward, sgtDate,
  type ModuleTaskInput, type SignalItem, type TaskSource, type TaskStep,
} from "../enrich/tasks";
import { htmlToText } from "../lib/html-text";
import { effectiveComponents } from "./profiles";

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
  fetchFn?: typeof fetch;
};

const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex").slice(0, 32);
const errText = (err: unknown) => String(err instanceof Error ? err.message : err).slice(0, 300);
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

  const open = rows
    .filter((i) => ["assignment", "event", "deadline"].includes(i.type) && !i.dismissed && !i.submitted && i.category !== "routine"
      && (i.dueAt === null ? i.type === "assignment" : i.dueAt >= now - D && i.dueAt <= now + 60 * D))
    .sort((a, b) => (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity)).slice(0, 25);
  const past = rows
    .filter((i) => ["assignment", "deadline"].includes(i.type) && i.dueAt !== null && i.dueAt < now && i.dueAt >= now - 60 * D)
    .sort((a, b) => b.dueAt! - a.dueAt!).slice(0, 15);
  const canvas: SignalItem[] = open.map((i) => {
    refs.set(`C${i.id}`, { kind: "canvas", label: i.title, itemId: i.id });
    const body = i.type === "assignment" ? htmlToText(i.body).slice(0, 300) : (i.body ?? "").slice(0, 200);
    return { ref: `C${i.id}`, line: `${i.type === "deadline" ? "From an announcement" : i.type === "event" ? "Calendar" : "Canvas"}: ${i.title} — ${due(i.dueAt)}`, body: body || undefined };
  });
  const pastRows: SignalItem[] = past.map((i) => {
    refs.set(`C${i.id}`, { kind: "canvas", label: i.title, itemId: i.id });
    return { ref: `C${i.id}`, line: `${i.title} — ${due(i.dueAt)}${i.submitted ? " (submitted)" : ""}` };
  });

  const announcements: SignalItem[] = rows
    .filter((i) => i.type === "announcement" && (i.sourceCreatedAt ?? i.firstSeenAt) >= now - 45 * D)
    .sort((a, b) => (b.sourceCreatedAt ?? b.firstSeenAt) - (a.sourceCreatedAt ?? a.firstSeenAt)).slice(0, 10)
    .map((i) => {
      refs.set(`A${i.id}`, { kind: "announcement", label: i.title, itemId: i.id });
      return { ref: `A${i.id}`, line: `${i.title} (posted ${sgtLabel(i.sourceCreatedAt ?? i.firstSeenAt)})`, body: htmlToText(i.body).replace(/\s+/g, " ").slice(0, 1200) };
    });

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

  const existing = db.select().from(tasks).where(and(eq(tasks.userId, userId), eq(tasks.moduleId, mod.id))).all().map((t) => {
    const steps = parseList<TaskStep>(t.stepsJson);
    return {
      key: t.key, title: t.title, due: t.dueAt === null ? null : sgtLabel(t.dueAt),
      progress: t.status === "open" ? `${steps.filter((s) => s.done).length}/${steps.length} steps done` : t.status,
    };
  });

  const d = new Date(now + 8 * H);
  return {
    refs,
    input: {
      today: `${sgtDate(now)} (${WEEKDAY[d.getUTCDay()]})`,
      module: { code: mod.code, name: mod.name },
      canvas, past: pastRows, announcements, fileHints: fileLines, weightage, examDate, studyAdvice, existing,
    },
  };
}

// --- writing a module's plan ----------------------------------------------------
function applyPlan(db: Db, userId: number, moduleId: number, planned: Awaited<ReturnType<typeof planModuleTasks>>, now: number) {
  const current = db.select().from(tasks).where(and(eq(tasks.userId, userId), eq(tasks.moduleId, moduleId))).all();
  // A key the planner reused from another module stays with that module.
  const elsewhere = new Set(db.select({ key: tasks.key, moduleId: tasks.moduleId }).from(tasks).where(eq(tasks.userId, userId)).all()
    .filter((t) => t.moduleId !== moduleId).map((t) => t.key));
  const ops = mergeTasks(
    current.map((t) => ({ id: t.id, key: t.key, status: t.status, touchedAt: t.touchedAt, steps: parseList<TaskStep>(t.stepsJson) })),
    planned.filter((t) => !elsewhere.has(t.key)),
  );
  db.transaction((tx) => {
    for (const t of ops.insert) {
      tx.insert(tasks).values({
        userId, moduleId, key: t.key, title: t.title, kind: t.kind, dueAt: t.dueAt, dueConfidence: t.dueConfidence,
        anticipated: t.anticipated, weightPct: t.weightPct, why: t.why, sourcesJson: JSON.stringify(t.sources),
        stepsJson: JSON.stringify(t.steps), status: "open", createdAt: now, updatedAt: now,
      }).run();
    }
    for (const u of ops.update) {
      const t = u.task;
      tx.update(tasks).set({
        title: t.title, kind: t.kind, dueAt: t.dueAt, dueConfidence: t.dueConfidence, anticipated: t.anticipated,
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
  const open = db.select().from(tasks).where(and(eq(tasks.userId, userId), eq(tasks.status, "open"))).all();
  if (!open.length) return 0;
  const itemIds = open.flatMap((t) => parseList<TaskSource>(t.sourcesJson).filter((s) => s.kind === "canvas" && s.itemId).map((s) => s.itemId!));
  const submitted = new Set(itemIds.length
    ? db.select({ id: items.id }).from(items).where(and(inArray(items.id, itemIds), eq(items.submitted, true))).all().map((r) => r.id)
    : []);
  const today = sgtDate(now);
  let changed = 0;
  const live: { id: number; key: string; dueAt: number | null; steps: TaskStep[]; before: string }[] = [];
  for (const t of open) {
    const canvasIds = parseList<TaskSource>(t.sourcesJson).filter((s) => s.kind === "canvas" && s.itemId).map((s) => s.itemId!);
    // An anticipated task cites past work only as the pattern it follows.
    if (!t.anticipated && canvasIds.length && canvasIds.every((id) => submitted.has(id)) && ["submission", "quiz", "project", "presentation"].includes(t.kind)) {
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

export type TaskRefreshResult = { files: number; planned: number; errors: string[] };

export async function refreshTasks(deps: TaskDeps, userId: number): Promise<TaskRefreshResult> {
  const { db } = deps;
  const out: TaskRefreshResult = { files: 0, planned: 0, errors: [] };
  const user = db.select().from(users).where(eq(users.id, userId)).get();
  if (!user) return out;
  const requested = user.tasksRequestedAt !== null;
  const mods = db.select().from(modules).where(and(eq(modules.userId, userId), eq(modules.active, true), eq(modules.hidden, false))).all();

  out.files = await harvestHints(deps, userId, mods);

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
        const planned = await planModuleTasks(cfg, c.input, c.refs, deps.now(), deps.fetchFn);
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

  tidyTasks(db, userId, deps.now());
  if (requested) db.update(users).set({ tasksRequestedAt: null }).where(eq(users.id, userId)).run();
  return out;
}
