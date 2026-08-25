import { createHmac, timingSafeEqual } from "node:crypto";

// Session format: "<userId>.<expiryMs>.<hmac>", where the HMAC covers
// "<userId>.<expiryMs>". The user id is inside the signed payload, so a
// session cannot be re-pointed at another account by editing the cookie.
const mac = (payload: string, keyHex: string) =>
  createHmac("sha256", Buffer.from(keyHex, "hex")).update(payload).digest("hex");

export function signSession(userId: number, secretHex: string, ttlMs = 30 * 24 * 3_600_000): string {
  const payload = `${userId}.${Date.now() + ttlMs}`;
  return `${payload}.${mac(payload, secretHex)}`;
}

// Returns the authenticated user id, or null. Never returns a default id:
// a caller that cannot identify the user must not fall back to one.
export function verifySession(value: string | undefined, secretHex: string): number | null {
  if (!value) return null;
  const parts = value.split(".");
  if (parts.length !== 3) return null;
  const [rawId, exp, sig] = parts as [string, string, string];
  if (!/^\d+$/.test(rawId) || !/^\d+$/.test(exp)) return null;
  if (Number(exp) < Date.now()) return null;
  const want = Buffer.from(mac(`${rawId}.${exp}`, secretHex));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  return Number(rawId);
}
