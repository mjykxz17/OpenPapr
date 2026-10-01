import { getDb } from "@/server/db";
import { calendarEvents, userForCalendarToken } from "@/server/calendar";
import { buildIcs } from "@/lib/ics";

export const dynamic = "force-dynamic";

// The private calendar feed. No session — calendar apps cannot sign in — so
// the long random token in the URL is the credential; resetting it in
// Account cuts off every copy of the old link.
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const token = (await params).token.replace(/\.ics$/, "");
  const db = getDb();
  const userId = userForCalendarToken(db, token);
  if (!userId) return new Response("Not found", { status: 404 });
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
