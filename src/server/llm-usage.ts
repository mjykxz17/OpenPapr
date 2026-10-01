import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { llmUsage } from "@/db/schema";

// Counts AI calls per student per month, and says whether they may still use
// the shared key. Kept to the database so the worker and the web server count
// into the same place.

export const usageMonth = (now: number) => new Date(now + 8 * 3_600_000).toISOString().slice(0, 7);

export function recordLlmCall(db: Db, userId: number, shared: boolean, now: number): void {
  const month = usageMonth(now);
  db.insert(llmUsage).values({ userId, month, calls: 1, sharedCalls: shared ? 1 : 0 })
    .onConflictDoUpdate({
      target: [llmUsage.userId, llmUsage.month],
      set: { calls: sql`${llmUsage.calls} + 1`, sharedCalls: sql`${llmUsage.sharedCalls} + ${shared ? 1 : 0}` },
    }).run();
}

export function usageThisMonth(db: Db, userId: number, now: number): { calls: number; sharedCalls: number } {
  const row = db.select().from(llmUsage).where(and(eq(llmUsage.userId, userId), eq(llmUsage.month, usageMonth(now)))).get();
  return { calls: row?.calls ?? 0, sharedCalls: row?.sharedCalls ?? 0 };
}

export function sharedAllowanceLeft(db: Db, userId: number, now: number, limit: number): number {
  return Math.max(0, limit - usageThisMonth(db, userId, now).sharedCalls);
}
