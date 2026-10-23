import { and, eq } from "drizzle-orm";
import type { Db } from "../../db/client";
import { canvasPageCache } from "../../db/schema";
import type { CanvasClient } from "./client";
import type { CanvasPage } from "./types";

// Course pages are read every sync for the file links pasted into them, and
// they rarely change. The page listing (one request) carries each page's
// updated_at, so a body is fetched again only when that has moved; the rest
// come from here. Pages are the same for everyone in a course, so the cache is
// per course and a cohort shares it — but a body is only ever read back for a
// page the student's own listing shows them.

// Canvas leaves updated_at out on some pages; those are re-read once a day.
const NO_STAMP_TTL_MS = 24 * 3_600_000;

export async function cachedPageBody(
  db: Db, canvas: Pick<CanvasClient, "getPageBody">, courseId: number, page: CanvasPage, now: number,
): Promise<string> {
  const hit = db.select().from(canvasPageCache)
    .where(and(eq(canvasPageCache.courseId, courseId), eq(canvasPageCache.pageUrl, page.url))).get();
  const stamp = page.updated_at ?? null;
  if (hit && (stamp ? hit.updatedAt === stamp : now - hit.fetchedAt < NO_STAMP_TTL_MS)) return hit.body;
  const body = await canvas.getPageBody(courseId, page.url);
  db.insert(canvasPageCache).values({ courseId, pageUrl: page.url, updatedAt: stamp, body, fetchedAt: now })
    .onConflictDoUpdate({ target: [canvasPageCache.courseId, canvasPageCache.pageUrl], set: { updatedAt: stamp, body, fetchedAt: now } })
    .run();
  return body;
}
