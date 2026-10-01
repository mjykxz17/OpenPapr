import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { guidePlans, guideTopics } from "../db/schema";

// The automatic guide's state, for the guide page. Kept apart from the worker
// so the web server does not load the generator to answer a status check.

// Asked for from the guide page: look again now, and optionally write every
// chapter afresh.
export function requestGuideRefresh(db: Db, moduleId: number, rewrite: boolean): void {
  db.update(guidePlans).set({ inputHash: null, errorAt: null }).where(eq(guidePlans.moduleId, moduleId)).run();
  db.update(guideTopics).set({ errorAt: null, ...(rewrite ? { builtHash: null } : {}) }).where(eq(guideTopics.moduleId, moduleId)).run();
}

export function guideStatus(db: Db, moduleId: number) {
  const topics = db.select().from(guideTopics).where(eq(guideTopics.moduleId, moduleId)).all().sort((a, b) => a.ord - b.ord);
  const plan = db.select().from(guidePlans).where(eq(guidePlans.moduleId, moduleId)).get();
  const writing = topics.find((t) => t.stage);
  return {
    title: plan?.title ?? null,
    planned: Boolean(plan?.plannedAt),
    planError: plan?.error ?? null,
    total: topics.length,
    ready: topics.filter((t) => t.body && t.builtHash === t.inputHash).length,
    queued: topics.filter((t) => t.builtHash !== t.inputHash).length,
    writing: writing ? { title: writing.title, stage: writing.stage } : null,
    failed: topics.filter((t) => t.error && t.builtHash !== t.inputHash).map((t) => t.title),
  };
}
