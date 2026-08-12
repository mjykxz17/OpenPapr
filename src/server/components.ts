import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { components, modules } from "../db/schema";

export interface ManualComponentInput {
  moduleId: number;
  name: string;
  weightPct: number | null;
  scorePct: number | null;
}

/**
 * Upserts a `manual` component row, scoped to a module the given user owns.
 * Returns false (no write performed) when the module doesn't exist or belongs
 * to a different user — callers should surface that as 404.
 */
export function upsertManualComponent(db: Db, userId: number, input: ManualComponentInput): boolean {
  const mod = db.select().from(modules).where(eq(modules.id, input.moduleId)).get();
  if (!mod || mod.userId !== userId) return false;

  db.insert(components)
    .values({ moduleId: input.moduleId, name: input.name, weightPct: input.weightPct, scorePct: input.scorePct, source: "manual" })
    .onConflictDoUpdate({
      target: [components.moduleId, components.name, components.source],
      set: { weightPct: input.weightPct, scorePct: input.scorePct },
    })
    .run();
  return true;
}
