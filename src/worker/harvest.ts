import { and, eq, notInArray } from "drizzle-orm";
import type { Db } from "../db/client";
import { upsertModuleFiles, type DiscoveredFile } from "../db/repo";
import { canvasPages, files, modules } from "../db/schema";
import type { CanvasClient } from "../connectors/canvas/client";
import { cachedPageBody } from "../connectors/canvas/page-cache";
import { extractCanvasFileLinks, type FileLinkSource } from "../lib/canvas-file-links";
import { outlineFileLinks, outlinePages, type CourseOutline } from "../lib/course-outline";
import type { CanvasPage } from "../connectors/canvas/types";

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
//
// The pages it reads are also kept for the student to read and search
// (canvas_pages): those the Pages tab lists, and those only the Modules tab
// leads to — some courses switch the Pages tab off and publish everything
// through Modules. Files the Modules tab lists count as linked too.

type Canvas = Pick<CanvasClient, "listCourseFiles" | "listPages" | "getPageBody" | "getFile">;

// Pages are capped so a course with a large wiki cannot dominate a sync.
const MAX_PAGES = 60;
// A link to a file the student cannot open (or one since deleted) is tried
// again after this long, not on every sync.
const UNREADABLE_RETRY_MS = 6 * 3_600_000;

export function createHarvester(deps: { db: Db; now: () => number }) {
  const { db } = deps;
  const unreadable = new Map<string, number>();   // `${moduleId}:${fileId}` -> when it last failed

  return async function harvestFiles(canvas: Canvas, courseId: number, moduleId: number, sources: FileLinkSource[], outline: CourseOutline | null = null): Promise<void> {
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
    let pageList: CanvasPage[] | null = null;
    try { pageList = await canvas.listPages(courseId); } catch {
      // Pages are disabled for some courses (CS4239 returns 404); not an error.
    }
    // A page only the Modules tab shows has no updated_at here: the cache
    // re-reads it once a day.
    const known = new Set((pageList ?? []).map((p) => p.url));
    const pages: CanvasPage[] = [...(pageList ?? []), ...(outline ? outlinePages(outline) : []).filter((p) => !known.has(p.url) && (known.add(p.url), true))]
      .slice(0, MAX_PAGES);
    const read: { page: CanvasPage; body: string }[] = [];
    for (const page of pages) {
      try {
        const body = await cachedPageBody(db, canvas, courseId, page, deps.now());
        fromPages.push({ label: page.title, html: body });
        if (body) read.push({ page, body });
      } catch { /* single page unreadable */ }
    }
    // Only a listing can say a page is gone (a failed one keeps what was
    // there), and a page that failed to read just now is not gone.
    keepPages(moduleId, read, pageList !== null || outline !== null ? pages.map((p) => p.url) : null);

    const onRecord = new Map(db.select().from(files).where(eq(files.moduleId, moduleId)).all().map((f) => [f.canvasFileId, f]));
    for (const link of extractCanvasFileLinks([...sources, ...fromPages, ...(outline ? outlineFileLinks(outline) : [])])) {
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
      const row = onRecord.get(link.id);
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

  function keepPages(moduleId: number, read: { page: CanvasPage; body: string }[], stillThere: string[] | null): void {
    const userId = db.select({ u: modules.userId }).from(modules).where(eq(modules.id, moduleId)).get()?.u;
    if (userId === undefined) return;
    const now = deps.now();
    db.transaction((tx) => {
      for (const { page, body } of read) {
        tx.insert(canvasPages).values({ userId, moduleId, pageUrl: page.url, title: page.title, body, updatedAt: page.updated_at ?? null, seenAt: now })
          .onConflictDoUpdate({ target: [canvasPages.moduleId, canvasPages.pageUrl], set: { title: page.title, body, updatedAt: page.updated_at ?? null, seenAt: now } }).run();
      }
      if (stillThere) {
        tx.delete(canvasPages).where(stillThere.length ? and(eq(canvasPages.moduleId, moduleId), notInArray(canvasPages.pageUrl, stillThere)) : eq(canvasPages.moduleId, moduleId)).run();
      }
    });
  }
}
