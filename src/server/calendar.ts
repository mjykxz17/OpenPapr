import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { items, modules, tasks, users } from "@/db/schema";
import type { CalEvent } from "@/lib/ics";
import { variantGroups } from "@/lib/variants";

// What goes into the student's calendar feed: every dated piece of work that
// is still to do (Canvas assignments and quizzes, extracted deadlines, their
// own planner notes, discussions that need a post), the quizzes and exams
// the planner expects, and — if they ask for it — each day's study steps.

const D = 86_400_000;
const parse = <T,>(json: string | null | undefined, fallback: T): T => { try { return json ? (JSON.parse(json) as T) : fallback; } catch { return fallback; } };
const sgtDate = (ms: number) => new Date(ms + 8 * 3_600_000).toISOString().slice(0, 10);

export function calendarEvents(db: Db, userId: number, now: number, opts: { steps: boolean; baseUrl: string }): CalEvent[] {
  const mods = new Map(db.select().from(modules).where(eq(modules.userId, userId)).all().filter((m) => m.active && !m.hidden).map((m) => [m.id, m]));
  const code = (id: number | null) => (id ? mods.get(id)?.code ?? null : null);
  const label = (id: number | null, title: string) => (code(id) ? `${code(id)}: ${title}` : title);
  const rows = db.select().from(items).where(eq(items.userId, userId)).all()
    .filter((i) => !i.dismissed && (i.moduleId === null ? i.type === "planner_note" : mods.has(i.moduleId)));
  const sets = variantGroups(rows);
  const doneSet = new Set([...sets.values()].filter((g) => g.ids.some((id) => { const r = rows.find((x) => x.id === id); return r && (r.submitted || r.canvasDone); })).map((g) => g.key));
  const seen = new Set<string>();
  const out: CalEvent[] = [];

  for (const i of rows) {
    if (i.dueAt === null || i.dueAt < now - 14 * D || i.dueAt > now + 200 * D) continue;
    if (i.submitted || i.canvasDone) continue;
    const meta = parse<{ graded?: boolean; posted?: boolean; locked?: boolean; quiz?: boolean; closesOnly?: boolean }>(i.metaJson, {});
    const kind = i.type === "assignment" || i.type === "planner_note" || (i.type === "deadline" && i.category !== "routine")
      || (i.type === "discussion" && !meta.graded && !meta.posted && !meta.locked);
    if (!kind) continue;
    let title = i.title;
    const set = sets.get(i.id);
    if (set) {
      if (seen.has(set.key) || doneSet.has(set.key)) continue;
      seen.add(set.key);
      title = `${set.stem} (your group's)`;
    }
    const what = i.type === "discussion" ? `Post in: ${title}` : meta.quiz && meta.closesOnly ? `${title} closes` : `${title} due`;
    out.push({
      uid: `item-${i.id}@openpapr`, title: label(i.moduleId, what), start: i.dueAt - 30 * 60_000, end: i.dueAt,
      url: i.url, description: [i.url ? `Canvas: ${i.url}` : null, `OpenPapr: ${opts.baseUrl}/tasks`].filter(Boolean).join("\n"),
    });
  }

  for (const t of db.select().from(tasks).where(eq(tasks.userId, userId)).all()) {
    if (t.status !== "open") continue;
    // Work already on Canvas is in the feed as itself; tasks add what is not:
    // expected quizzes, exams, things the student added, things only an
    // announcement or a slide mentioned.
    // An expected quiz cites the last real one only as its pattern.
    const fromCanvas = !t.anticipated && parse<{ kind: string; itemId?: number }[]>(t.sourcesJson, []).some((s) => (s.kind === "canvas" || s.kind === "planner") && s.itemId);
    if (!fromCanvas && t.dueAt !== null && t.dueAt > now - D && t.dueAt < now + 200 * D) {
      out.push(t.dueConfidence === "estimated"
        ? { uid: `task-${t.id}@openpapr`, title: label(t.moduleId, `${t.title} (date estimated)`), date: sgtDate(t.dueAt), allDay: true, description: `${t.why ?? ""}\nOpenPapr: ${opts.baseUrl}/tasks`.trim() }
        : { uid: `task-${t.id}@openpapr`, title: label(t.moduleId, t.title), start: t.dueAt - 30 * 60_000, end: t.dueAt, description: `OpenPapr: ${opts.baseUrl}/tasks` });
    }
    if (opts.steps) {
      for (const s of parse<{ id: string; text: string; minutes: number; doBy: string; done: boolean }[]>(t.stepsJson, [])) {
        if (s.done || s.doBy < sgtDate(now - D)) continue;
        out.push({ uid: `step-${t.id}-${s.id}@openpapr`, title: `${code(t.moduleId) ? `${code(t.moduleId)} · ` : ""}${s.text} (${s.minutes} min)`, date: s.doBy, allDay: true, description: `For: ${t.title}\nOpenPapr: ${opts.baseUrl}/tasks` });
      }
    }
  }
  return out;
}

export function calendarToken(db: Db, userId: number, reset: boolean): string {
  const u = db.select({ t: users.calendarToken }).from(users).where(eq(users.id, userId)).get();
  if (u?.t && !reset) return u.t;
  const t = randomBytes(24).toString("base64url");
  db.update(users).set({ calendarToken: t }).where(eq(users.id, userId)).run();
  return t;
}

export function userForCalendarToken(db: Db, token: string): number | null {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  return db.select({ id: users.id }).from(users).where(eq(users.calendarToken, token)).get()?.id ?? null;
}
