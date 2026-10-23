import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { upsertModuleFiles, type DiscoveredFile } from "../db/repo";
import { files } from "../db/schema";
import type { CanvasClient } from "../connectors/canvas/client";
import { cachedPageBody } from "../connectors/canvas/page-cache";
import { extractCanvasFileLinks, type FileLinkSource } from "../lib/canvas-file-links";

// Records every file a module has, from two sources that barely overlap: the
// Files listing, and links pasted into announcements or the syllabus. Some
// courses keep their entire deck set in the second category — IFS4103's Files
// tab holds two recruitment posters while its lecture slides are reachable
// only by id, hidden from the listing, and the study guide for that module
// consequently had no slides to cite.
//
// Only files LINKED FROM CONTENT the student can already read are harvested.
// hidden:true can mean deliberately withheld as well as merely unlisted, and
// following a link the course itself published is what keeps the distinction
// honest.
//
// It runs for every course on every sync, so it asks Canvas for as little as
// it can: page bodies come from the page cache unless the page was edited,
// and a linked file already on record is not looked up again.

type Canvas = Pick<CanvasClient, "listCourseFiles" | "listPages" | "getPageBody" | "getFile">;

// Pages are capped so a course with a large wiki cannot dominate a sync.
const MAX_PAGES = 25;
// A link to a file the student cannot open (or one since deleted) is tried
// again after this long, not on every sync.
const UNREADABLE_RETRY_MS = 6 * 3_600_000;

export function createHarvester(deps: { db: Db; now: () => number }) {
  const { db } = deps;
  const unreadable = new Map<string, number>();   // `${moduleId}:${fileId}` -> when it last failed

  return async function harvestFiles(canvas: Canvas, courseId: number, moduleId: number, sources: FileLinkSource[]): Promise<void> {
    const discovered = new Map<number, DiscoveredFile>();

    const listed = await (async () => {
      try { return await canvas.listCourseFiles(courseId); } catch { return []; }
    })();
    for (const f of listed) {
      discovered.set(f.id, {
        canvasFileId: f.id, displayName: f.display_name,
        contentType: f["content-type"] ?? null, sizeBytes: f.size ?? null, hidden: false,
      });
    }

    // Pages carry the links the Files tab omits: IFS4103 publishes its lecture
    // decks on two content pages and nowhere else.
    const fromPages: FileLinkSource[] = [];
    try {
      for (const page of (await canvas.listPages(courseId)).slice(0, MAX_PAGES)) {
        try { fromPages.push({ label: page.title, html: await cachedPageBody(db, canvas, courseId, page, deps.now()) }); } catch { /* single page unreadable */ }
      }
    } catch {
      // Pages are disabled for some courses (CS4239 returns 404); not an error.
    }

    const known = new Map(db.select().from(files).where(eq(files.moduleId, moduleId)).all().map((f) => [f.canvasFileId, f]));
    for (const link of extractCanvasFileLinks([...sources, ...fromPages])) {
      const seen = discovered.get(link.id);
      if (seen) {
        // Listed AND linked: keep the link's context, it helps categorisation.
        seen.linkedFrom = link.linkedFrom;
        seen.linkContext = link.context;
        continue;
      }
      // Already on record from an earlier sync: what Canvas said then still
      // holds (a corrected deck is a new upload with a new id, so it is not
      // missed). Only the link's context is refreshed.
      const row = known.get(link.id);
      if (row) {
        discovered.set(link.id, {
          canvasFileId: row.canvasFileId, displayName: row.displayName,
          contentType: row.contentType, sizeBytes: row.sizeBytes, hidden: true,
          linkedFrom: link.linkedFrom, linkContext: link.context,
        });
        continue;
      }
      const key = `${moduleId}:${link.id}`;
      const failedAt = unreadable.get(key);
      if (failedAt !== undefined && deps.now() - failedAt < UNREADABLE_RETRY_MS) continue;
      try {
        const f = await canvas.getFile(link.id);
        unreadable.delete(key);
        discovered.set(link.id, {
          canvasFileId: f.id, displayName: f.display_name,
          contentType: f["content-type"] ?? null, sizeBytes: f.size ?? null, hidden: true,
          linkedFrom: link.linkedFrom, linkContext: link.context,
        });
      } catch {
        // A link can point at a file the student cannot read, or one since
        // deleted. Skip it rather than failing the whole course sync.
        unreadable.set(key, deps.now());
      }
    }

    if (discovered.size > 0) upsertModuleFiles(db, moduleId, [...discovered.values()], deps.now());
  };
}
