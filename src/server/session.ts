import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifySession } from "./auth";
import { loadEnv, sessionSigningKey } from "@/lib/env";
import { eq } from "drizzle-orm";
import { users } from "@/db/schema";
import { getDb } from "./db";

// The authenticated user, or null. Middleware already turns anonymous traffic
// away, so a null here means a session that expired between the gate and the
// handler — or a caller reached directly. Either way there is no default user
// to fall back to.
export async function currentUserId(): Promise<number | null> {
  const jar = await cookies();
  const id = verifySession(jar.get("session")?.value, sessionSigningKey(loadEnv()));
  // A signed cookie outlives a deleted account; the account must still exist.
  if (id !== null && !getDb().select({ id: users.id }).from(users).where(eq(users.id, id)).get()) return null;
  return id;
}

// For server components: sends the visitor to sign in rather than rendering
// somebody else's dashboard.
export async function requireUserId(): Promise<number> {
  const id = await currentUserId();
  if (id === null) redirect("/login");
  return id;
}

// The public demo account is shared by everyone who opens it, so its
// settings stay as they are.
export function isDemoUser(userId: number): boolean {
  return Boolean(getDb().select({ d: users.isDemo }).from(users).where(eq(users.id, userId)).get()?.d);
}
export const DEMO_LOCKED = "This is the shared demo account, so its settings can't be changed. Create your own account to connect Canvas and an AI key.";
