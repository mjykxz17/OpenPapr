import { createHmac, timingSafeEqual } from "node:crypto";

// Session format: "<userId>.<version>.<expiryMs>.<hmac>", where the HMAC
// covers everything before it. The user id is inside the signed payload, so a
// session cannot be re-pointed at another account by editing the cookie. The
// version is the account's sessionVersion when it was signed: bumping that
// column (a password change, "sign out everywhere") retires every older
// cookie. This file only checks the signature — the version is compared with
// the database in session.ts, so the proxy can stay free of database reads.
const mac = (payload: string, keyHex: string) =>
  createHmac("sha256", Buffer.from(keyHex, "hex")).update(payload).digest("hex");

// One source of truth for how long a session lasts. The cookie's max-age is
// derived from this: when the two drifted, the signed token stayed valid for
// 30 days while the cookie carried no expiry at all, so the browser discarded
// it on close and every visit began at the sign-in form.
export const SESSION_TTL_MS = 30 * 24 * 3_600_000;

export function signSession(userId: number, secretHex: string, ttlMs = SESSION_TTL_MS, version = 0): string {
  const payload = `${userId}.${version}.${Date.now() + ttlMs}`;
  return `${payload}.${mac(payload, secretHex)}`;
}

export type Session = { userId: number; version: number };

// The signed user id and session version, or null. Never returns a default
// id: a caller that cannot identify the user must not fall back to one.
// Cookies signed before versions existed ("<userId>.<expiryMs>.<hmac>") read
// as version 0, so the deploy that added versions signed nobody out.
export function readSession(value: string | undefined, secretHex: string): Session | null {
  if (!value || !secretHex) return null;
  const parts = value.split(".");
  if (parts.length !== 3 && parts.length !== 4) return null;
  const sig = parts.pop()!;
  const [rawId, rawVersion, exp] = parts.length === 3 ? parts : [parts[0]!, "0", parts[1]!];
  if (!parts.every((p) => /^\d+$/.test(p))) return null;
  if (Number(exp) < Date.now()) return null;
  const want = Buffer.from(mac(parts.join("."), secretHex));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  return { userId: Number(rawId), version: Number(rawVersion) };
}

// Just the user id: enough for the proxy's "is this a valid session" gate.
export function verifySession(value: string | undefined, secretHex: string): number | null {
  return readSession(value, secretHex)?.userId ?? null;
}
