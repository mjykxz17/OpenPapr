import { eq, inArray } from "drizzle-orm";
import type { Db } from "../db/client";
import { components, items, modules, syncRuns, users } from "../db/schema";

export type ItemRow = typeof items.$inferSelect;
export type ComponentRow = typeof components.$inferSelect;

export interface Overview {
  lastSeenAt: number;
  whatsNew: ItemRow[]; // firstSeenAt > lastSeenAt, newest first, cap 20
  todos: ItemRow[]; // type in (assignment,event), !dismissed, !submitted; overdue (dueAt < now) first, then dueAt asc, nulls last
  mail: { important: ItemRow[]; filteredCount: number }; // important = triage in (important,ambiguous,unscored) & !dismissed, newest 20; filteredCount = garbage count
  modules: { id: number; code: string; name: string; components: ComponentRow[]; latestAnnouncements: ItemRow[]; unaccountedPct: number | null }[];
  syncStatus: { source: string; lastOkAt: number | null; stale: boolean }[]; // stale = now - lastOkAt > 3 * pollIntervalMs
  graphAuthBroken: boolean; // latest graph sync_run failed with /401|invalid_grant/ — drives the reconnect banner
}

const SYNC_SOURCES = ["canvas", "graph", "enrich"] as const;

// manual > llm_syllabus > canvas_api
const COMPONENT_PRECEDENCE: Record<ComponentRow["source"], number> = {
  manual: 3,
  llm_syllabus: 2,
  canvas_api: 1,
};

function dedupeComponents(rows: ComponentRow[]): ComponentRow[] {
  const byName = new Map<string, ComponentRow>();
  for (const c of rows) {
    const key = c.name.toLowerCase();
    const existing = byName.get(key);
    if (!existing || COMPONENT_PRECEDENCE[c.source] > COMPONENT_PRECEDENCE[existing.source]) {
      byName.set(key, c);
    }
  }
  return [...byName.values()];
}

function compareTodos(now: number) {
  return (a: ItemRow, b: ItemRow): number => {
    const aOverdue = a.dueAt !== null && a.dueAt < now;
    const bOverdue = b.dueAt !== null && b.dueAt < now;
    if (aOverdue !== bOverdue) return aOverdue ? -1 : 1;
    if (a.dueAt === null && b.dueAt === null) return 0;
    if (a.dueAt === null) return 1;
    if (b.dueAt === null) return -1;
    return a.dueAt - b.dueAt;
  };
}

const byNewestFirst = (a: ItemRow, b: ItemRow) => b.firstSeenAt - a.firstSeenAt;

export function getOverview(db: Db, userId: number, now: number, pollIntervalMs: number): Overview {
  const user = db.select().from(users).where(eq(users.id, userId)).get();
  const lastSeenAt = user?.lastSeenAt ?? 0;

  const allItems = db.select().from(items).where(eq(items.userId, userId)).all();

  const allMods = db.select().from(modules).where(eq(modules.userId, userId)).all();
  const inactiveModIds = new Set(allMods.filter((m) => !m.active).map((m) => m.id));
  // Emails always show regardless of module link (fail-open); canvas-derived
  // items from inactive (past-term) modules are hidden everywhere.
  const scopedItems = allItems.filter(
    (i) => i.type === "email" || i.moduleId === null || !inactiveModIds.has(i.moduleId),
  );

  const whatsNew = scopedItems
    .filter((i) => i.firstSeenAt > lastSeenAt)
    .sort(byNewestFirst)
    .slice(0, 20);

  const todos = scopedItems
    .filter((i) => (i.type === "assignment" || i.type === "event") && !i.dismissed && !i.submitted)
    .sort(compareTodos(now));

  const mailItems = allItems.filter((i) => i.type === "email");
  const important = mailItems
    .filter((i) => !i.dismissed && (i.triage === "important" || i.triage === "ambiguous" || i.triage === "unscored"))
    .sort(byNewestFirst)
    .slice(0, 20);
  const filteredCount = mailItems.filter((i) => i.triage === "garbage").length;

  const mods = allMods.filter((m) => m.active);
  const modIds = mods.map((m) => m.id);
  const allComponents = modIds.length ? db.select().from(components).where(inArray(components.moduleId, modIds)).all() : [];

  const modulesOut = mods.map((m) => {
    const comps = dedupeComponents(allComponents.filter((c) => c.moduleId === m.id));
    const sumWeight = comps.reduce((sum, c) => sum + (c.weightPct ?? 0), 0);
    const unaccountedPct = comps.length > 0 && sumWeight < 90 ? 100 - sumWeight : null;
    const latestAnnouncements = allItems
      .filter((i) => i.moduleId === m.id && i.type === "announcement")
      .sort(byNewestFirst);
    return { id: m.id, code: m.code, name: m.name, components: comps, latestAnnouncements, unaccountedPct };
  });

  const allSyncRuns = db.select().from(syncRuns).where(eq(syncRuns.userId, userId)).all();

  const syncStatus = SYNC_SOURCES.map((source) => {
    const okRuns = allSyncRuns.filter((r) => r.source === source && r.ok);
    const lastOkAt = okRuns.length ? Math.max(...okRuns.map((r) => r.finishedAt ?? r.startedAt)) : null;
    const stale = lastOkAt === null ? true : now - lastOkAt > 3 * pollIntervalMs;
    return { source, lastOkAt, stale };
  });

  const graphRuns = allSyncRuns.filter((r) => r.source === "graph");
  const latestGraphRun = graphRuns.length ? graphRuns.reduce((latest, r) => (r.startedAt > latest.startedAt ? r : latest)) : null;
  const graphAuthBroken = !!latestGraphRun && latestGraphRun.ok === false && !!latestGraphRun.error && /401|invalid_grant/.test(latestGraphRun.error);

  return { lastSeenAt, whatsNew, todos, mail: { important, filteredCount }, modules: modulesOut, syncStatus, graphAuthBroken };
}
