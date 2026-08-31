import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

// scrypt from node:crypto rather than a dependency: it is a memory-hard KDF,
// which is what a password needs — a plain SHA hash is far too cheap to brute
// force. Parameters are stored alongside the hash so they can be raised later
// without invalidating existing passwords.
const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, KEYLEN, { N, r: R, p: P, maxmem: 64 * 1024 * 1024 });
  return ["scrypt", N, R, P, salt.toString("hex"), key.toString("hex")].join("$");
}

export function verifyPassword(password: string, stored: string | null | undefined): boolean {
  if (!stored) return false;
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, saltHex, keyHex] = parts as [string, string, string, string, string, string];
  if (!/^[0-9a-f]+$/i.test(saltHex) || !/^[0-9a-f]+$/i.test(keyHex)) return false;
  const want = Buffer.from(keyHex, "hex");
  let got: Buffer;
  try {
    got = scryptSync(password, Buffer.from(saltHex, "hex"), want.length,
      { N: Number(n), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024 });
  } catch {
    return false;
  }
  return want.length === got.length && timingSafeEqual(want, got);
}

// Usernames are an identity key, so they are compared in one canonical form.
export const normalizeUsername = (raw: string): string => raw.trim().toLowerCase();
