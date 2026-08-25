// run: npx tsx scripts/backfill-canvas-user-id.ts
//
// One-off, idempotent. Rows created before multi-user have no canvas_user_id,
// so their owner is only recognised at sign-in by presenting the exact token
// already stored. That is fragile: generate a fresh Canvas token instead and
// you get a new empty account while your real data sits orphaned.
//
// This asks Canvas who each stored token belongs to and writes the answer
// down, so afterwards ANY valid token for that Canvas account resolves to the
// existing row. Safe to re-run; rows already stamped are skipped.
import { eq, isNull } from "drizzle-orm";
import { createDb } from "../src/db/client";
import { users } from "../src/db/schema";
import { loadEnv } from "../src/lib/env";
import { decrypt } from "../src/lib/crypto";
import { createCanvasClient } from "../src/connectors/canvas/client";

const env = loadEnv();
const db = createDb(env.DATABASE_PATH);

const pending = db.select().from(users).where(isNull(users.canvasUserId)).all();
if (pending.length === 0) {
  console.log("nothing to backfill — every user already has a canvas_user_id");
  process.exit(0);
}

let done = 0;
for (const row of pending) {
  if (!row.canvasTokenEnc) {
    console.log(`user ${row.id} (${row.name}): no Canvas token stored, skipping`);
    continue;
  }
  let token: string;
  try {
    token = decrypt(row.canvasTokenEnc, env.SECRET_KEY);
  } catch {
    console.log(`user ${row.id} (${row.name}): token will not decrypt with this SECRET_KEY, skipping`);
    continue;
  }
  try {
    const self = await createCanvasClient(env.CANVAS_BASE_URL, token).getSelf();
    db.update(users).set({ canvasUserId: self.id, name: self.name }).where(eq(users.id, row.id)).run();
    console.log(`user ${row.id}: linked to Canvas user ${self.id} (${self.name})`);
    done++;
  } catch (err) {
    console.log(`user ${row.id} (${row.name}): Canvas rejected the stored token — ${String(err).slice(0, 120)}`);
  }
}
console.log(`backfilled ${done} of ${pending.length}`);
