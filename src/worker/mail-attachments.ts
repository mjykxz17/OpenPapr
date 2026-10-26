import { createHash } from "node:crypto";
import { extname, join } from "node:path";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { items, mailAttachments } from "../db/schema";
import { downloadAttachment, listAttachments, type GraphMessage } from "../connectors/graph/client";
import { streamToFile } from "../server/io";
import { mailCacheDir } from "../server/mail-cache";

// Files attached to the student's emails, fetched once when the email
// arrives (the worker holds the only Microsoft token; nothing else can ask
// later) and kept on the volume beside the other caches. Mail sync sees each
// email once, so what is skipped here is skipped for good: only the last two
// months of a newly linked mailbox, and bounded per file and per student so
// attachments can't fill the disk.

const MAX_FILE = 25_000_000;
const MAX_PER_USER = 300_000_000;
const RECENT_MS = 60 * 86_400_000;
// A safety stop for one sync, far above a real two months.
const PER_SYNC = 150;

export async function fetchMailAttachments(
  db: Db, accessToken: string, userId: number, messages: GraphMessage[], now: number, fetchFn: typeof fetch = fetch,
): Promise<number> {
  let fetched = 0;
  let used = db.select({ s: sql<number>`coalesce(sum(${mailAttachments.sizeBytes}), 0)` }).from(mailAttachments)
    .where(and(eq(mailAttachments.userId, userId), isNotNull(mailAttachments.path))).get()?.s ?? 0;
  const recent = (m: GraphMessage) => !m.receivedDateTime || now - Date.parse(m.receivedDateTime) <= RECENT_MS;
  for (const m of messages.filter((x) => x.hasAttachments && recent(x))) {
    if (fetched >= PER_SYNC) break;
    const item = db.select({ id: items.id }).from(items)
      .where(and(eq(items.userId, userId), eq(items.source, "graph"), eq(items.sourceId, `mail:${m.id}`))).get();
    if (!item) continue;
    let list;
    try { list = await listAttachments(accessToken, m.id, fetchFn); } catch { continue; }
    for (const a of list) {
      const had = db.select({ id: mailAttachments.id }).from(mailAttachments)
        .where(and(eq(mailAttachments.itemId, item.id), eq(mailAttachments.graphId, a.id))).get();
      if (had) continue;
      let path: string | null = null;
      if ((a.size ?? 0) <= MAX_FILE && used + (a.size ?? 0) <= MAX_PER_USER && fetched < PER_SYNC) {
        const target = join(mailCacheDir(userId), `${item.id}-${createHash("sha256").update(a.id).digest("hex").slice(0, 16)}${extname(a.name).toLowerCase()}`);
        try {
          await streamToFile(await downloadAttachment(accessToken, m.id, a.id, fetchFn), target, MAX_FILE);
          path = target;
          used += a.size ?? 0;
          fetched++;
        } catch { /* recorded without a copy; the email still says it had one */ }
      }
      db.insert(mailAttachments).values({ userId, itemId: item.id, graphId: a.id, name: a.name, contentType: a.contentType, sizeBytes: a.size, path, fetchedAt: now })
        .onConflictDoNothing().run();
    }
  }
  return fetched;
}
