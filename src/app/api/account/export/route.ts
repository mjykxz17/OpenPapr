import { NextResponse } from "next/server";
import { currentUserId } from "@/server/session";
import { DEMO_NO_EXPORT, isDemoUser } from "@/server/demo-guard";
import { getDb } from "@/server/db";
import { exportAccount } from "@/server/account-data";

export const dynamic = "force-dynamic";

// Everything OpenPapr holds about the signed-in student, as one JSON file.
// Not for the shared demo account: it would hand out whatever the day's
// other visitors typed into it.
export async function GET() {
  const userId = await currentUserId();
  if (userId === null) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  // The Account page doesn't offer the demo this link, but the address can
  // still be opened by hand, and a sentence reads better there than JSON.
  if (isDemoUser(userId)) {
    return new Response(DEMO_NO_EXPORT, { status: 403, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
  }
  const data = exportAccount(getDb(), userId);
  if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="openpapr-export-${new Date().toISOString().slice(0, 10)}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
