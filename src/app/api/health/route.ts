import { NextResponse } from "next/server";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { sql } from "drizzle-orm";
import { getDb } from "@/server/db";
import { loadEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

// For Fly's health check and for a human glancing at the service. The status
// code reflects the web server only (can it reach its database?): a stalled
// worker is reported in the body but must not pull the site out of rotation —
// start.sh restarts the worker, and pages keep working without it.
export async function GET() {
  let db = false;
  try {
    getDb().get(sql`select 1`);
    db = true;
  } catch { /* reported below */ }
  let workerAgeSec: number | null = null;
  try {
    const beat = Number(readFileSync(join(dirname(loadEnv().DATABASE_PATH), "worker-heartbeat"), "utf8"));
    if (Number.isFinite(beat)) workerAgeSec = Math.round((Date.now() - beat) / 1000);
  } catch { /* no heartbeat yet */ }
  const worker = workerAgeSec === null ? "unknown" : workerAgeSec < 600 ? "ok" : "stalled";
  return NextResponse.json({ ok: db, db: db ? "ok" : "down", worker, workerAgeSec }, {
    status: db ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
