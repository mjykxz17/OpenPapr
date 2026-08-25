import { eq } from "drizzle-orm";
import { getDb } from "./db";
import { users } from "@/db/schema";
import { encrypt } from "@/lib/crypto";
import { loadEnv } from "@/lib/env";
import { pollDeviceCode, startDeviceCode } from "@/connectors/graph/auth";

// One in-flight device-code grant per user, held in memory. It lives for at
// most the ~15 minutes Microsoft allows and is discarded the moment it
// completes, so it never needs to survive a restart or reach the database.
// Single Next server process, so one map is the whole picture.
type Pending = { deviceCode: string; expiresAt: number };
const pending = new Map<number, Pending>();

const prune = (now: number) => {
  for (const [k, v] of pending) if (now >= v.expiresAt) pending.delete(k);
};

export type ConnectStart = { verificationUri: string; userCode: string; intervalMs: number };

export async function beginGraphConnect(userId: number, now = Date.now()): Promise<ConnectStart> {
  prune(now);
  const { MS_CLIENT_ID } = loadEnv();
  if (!MS_CLIENT_ID) throw new Error("Outlook is not configured on this instance");
  const start = await startDeviceCode(MS_CLIENT_ID);
  pending.set(userId, { deviceCode: start.deviceCode, expiresAt: now + start.expiresInMs });
  return { verificationUri: start.verificationUri, userCode: start.userCode, intervalMs: start.intervalMs };
}

export type ConnectPoll =
  | { status: "pending" }
  | { status: "connected" }
  | { status: "expired" }
  | { status: "error"; error: string };

export async function pollGraphConnect(userId: number, now = Date.now()): Promise<ConnectPoll> {
  const entry = pending.get(userId);
  if (!entry) return { status: "expired" };
  if (now >= entry.expiresAt) {
    pending.delete(userId);
    return { status: "expired" };
  }
  const env = loadEnv();
  if (!env.MS_CLIENT_ID) return { status: "error", error: "Outlook is not configured on this instance" };

  const poll = await pollDeviceCode(env.MS_CLIENT_ID, entry.deviceCode);
  if (poll.status === "pending" || poll.status === "slow_down") return { status: "pending" };
  if (poll.status === "error") {
    pending.delete(userId);
    return { status: "error", error: poll.error };
  }
  if (!poll.refreshToken) {
    pending.delete(userId);
    return { status: "error", error: "Microsoft returned no refresh token — the offline_access scope is missing" };
  }

  // Reset the delta link: the mailbox must be re-read from scratch against the
  // new grant rather than resumed from a cursor issued under the old one.
  getDb().update(users)
    .set({ msRefreshTokenEnc: encrypt(poll.refreshToken, env.SECRET_KEY), msDeltaLink: null })
    .where(eq(users.id, userId)).run();
  pending.delete(userId);
  return { status: "connected" };
}

export function disconnectGraph(userId: number): void {
  pending.delete(userId);
  getDb().update(users).set({ msRefreshTokenEnc: null, msDeltaLink: null }).where(eq(users.id, userId)).run();
}

export function clearPendingConnects(): void {
  pending.clear();
}
