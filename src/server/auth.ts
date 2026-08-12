import { createHmac, timingSafeEqual } from "node:crypto";

const mac = (exp: string, keyHex: string) =>
  createHmac("sha256", Buffer.from(keyHex, "hex")).update(exp).digest("hex");

export function signSession(secretHex: string, ttlMs = 30 * 24 * 3_600_000): string {
  const exp = String(Date.now() + ttlMs);
  return `${exp}.${mac(exp, secretHex)}`;
}

export function verifySession(value: string | undefined, secretHex: string): boolean {
  if (!value) return false;
  const [exp, sig] = value.split(".");
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  const want = Buffer.from(mac(exp, secretHex));
  const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got);
}
