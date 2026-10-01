import { NextResponse } from "next/server";
import { currentUserId } from "@/server/session";
import { getDb } from "@/server/db";
import { exportAccount } from "@/server/account-data";

export const dynamic = "force-dynamic";

// Everything OpenPapr holds about the signed-in student, as one JSON file.
export async function GET() {
  const userId = await currentUserId();
  if (userId === null) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
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
