import { getDb } from "@/server/db";
import { calendarEvents, userForCalendarToken } from "@/server/calendar";
import { buildIcs } from "@/lib/ics";
import { and, desc, eq } from "drizzle-orm";
import { syncRuns } from "@/db/schema";
import { requestSync } from "@/db/repo";

// The server sleeps when nobody is using it, so a calendar app checking the
// feed is often what wakes it. It gets what is known now, and a sync is asked
// for so the next check has today's Canvas.
const FEED_SYNC_AFTER_MS = 30 * 60_000;

export const dynamic = "force-dynamic";

// The private calendar feed. No session — calendar apps cannot sign in — so
// the long random token in the URL is the credential; resetting it in
// Account cuts off every copy of the old link.
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const token = (await params).token.replace(/\.ics$/, "");
  const db = getDb();
  const userId = userForCalendarToken(db, token);
  if (!userId) return new Response("Not found", { status: 404 });
  const last = db.select({ at: syncRuns.finishedAt }).from(syncRuns)
    .where(and(eq(syncRuns.userId, userId), eq(syncRuns.source, "canvas"), eq(syncRuns.ok, true))).orderBy(desc(syncRuns.id)).limit(1).get();
  if (!last?.at || Date.now() - last.at > FEED_SYNC_AFTER_MS) requestSync(db, userId, Date.now());
  const url = new URL(request.url);
  const base = `${request.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "")}://${request.headers.get("host") ?? url.host}`;
  const ics = buildIcs("OpenPapr", calendarEvents(db, userId, Date.now(), { steps: url.searchParams.get("steps") === "1", baseUrl: base }), Date.now());
  return new Response(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="openpapr.ics"',
      "Cache-Control": "private, max-age=900",
    },
  });
}
