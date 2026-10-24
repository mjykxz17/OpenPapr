import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { users } from "@/db/schema";

// The key Claude Code (or any MCP client) reads a student's material with.
// Only its SHA-256 is kept: the key is shown once, when it is made, and a
// database copy that got out would not let anyone in. Making a new one
// replaces the old, and turning it off removes it; either cuts off every
// client still holding the old key.

const PREFIX = "opk_";
const hash = (key: string) => createHash("sha256").update(key).digest("hex");

export function makeMcpKey(db: Db, userId: number, now: number): string {
  const key = `${PREFIX}${randomBytes(32).toString("base64url")}`;
  db.update(users).set({ mcpTokenHash: hash(key), mcpTokenAt: now }).where(eq(users.id, userId)).run();
  return key;
}

export function removeMcpKey(db: Db, userId: number): void {
  db.update(users).set({ mcpTokenHash: null, mcpTokenAt: null }).where(eq(users.id, userId)).run();
}

// The account an "Authorization: Bearer <key>" header belongs to, or null.
// The demo account cannot make a key, and is refused here too in case it
// somehow has one.
export function userForMcpKey(db: Db, header: string | null): number | null {
  const key = header?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!key || !key.startsWith(PREFIX) || key.length > 100) return null;
  const row = db.select({ id: users.id, isDemo: users.isDemo }).from(users).where(eq(users.mcpTokenHash, hash(key))).get();
  if (!row || row.isDemo) return null;
  return row.id;
}
