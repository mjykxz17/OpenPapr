import { randomBytes, scrypt, scryptSync, timingSafeEqual, type ScryptOptions } from "node:crypto";

// scrypt from node:crypto rather than a dependency: it is a memory-hard KDF,
// which is what a password needs — a plain SHA hash is far too cheap to brute
// force. Parameters are stored alongside the hash ("scrypt$N$r$p$salt$key"),
// so they can be raised without invalidating existing passwords: old hashes
// still verify, and sign-in rewrites them with the current cost.
//
// N=2^14, r=8, p=5 is one of OWASP's listed scrypt settings. Of those it has
// the smallest memory footprint (16 MiB a hash, inside Node's 32 MiB default
// maxmem), which matters on a 1 GB machine where several people may sign in
// at once; the higher p buys the work factor instead.
const COST = { N: 16384, r: 8, p: 5 };
const KEYLEN = 64;
// Room for any cost this file has written; a stored hash asking for more is
// refused rather than allowed to eat the machine's memory.
const MAXMEM = 64 * 1024 * 1024;

type Parsed = { N: number; r: number; p: number; salt: Buffer; key: Buffer };

function parse(stored: string | null | undefined): Parsed | null {
  if (!stored) return null;
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return null;
  const [, n, r, p, saltHex, keyHex] = parts as [string, string, string, string, string, string];
  if (![n, r, p].every((x) => /^\d+$/.test(x))) return null;
  if (!/^[0-9a-f]+$/i.test(saltHex) || !/^[0-9a-f]+$/i.test(keyHex)) return null;
  return { N: Number(n), r: Number(r), p: Number(p), salt: Buffer.from(saltHex, "hex"), key: Buffer.from(keyHex, "hex") };
}

const opts = (c: { N: number; r: number; p: number }): ScryptOptions => ({ N: c.N, r: c.r, p: c.p, maxmem: MAXMEM });
const format = (salt: Buffer, key: Buffer) => ["scrypt", COST.N, COST.r, COST.p, salt.toString("hex"), key.toString("hex")].join("$");
const matches = (want: Buffer, got: Buffer) => want.length === got.length && timingSafeEqual(want, got);

// The async versions run on libuv's thread pool, so a sign-in does not stall
// every other request for the tenth of a second a hash takes. The sync ones
// are for scripts and tests.
const scryptAsync = (password: string, salt: Buffer, len: number, o: ScryptOptions) =>
  new Promise<Buffer>((resolve, reject) => scrypt(password, salt, len, o, (err, key) => (err ? reject(err) : resolve(key))));

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  return format(salt, scryptSync(password, salt, KEYLEN, opts(COST)));
}

export async function hashPasswordAsync(password: string): Promise<string> {
  const salt = randomBytes(16);
  return format(salt, await scryptAsync(password, salt, KEYLEN, opts(COST)));
}

export function verifyPassword(password: string, stored: string | null | undefined): boolean {
  const h = parse(stored);
  if (!h) return false;
  try {
    return matches(h.key, scryptSync(password, h.salt, h.key.length, opts(h)));
  } catch {
    return false;
  }
}

export async function verifyPasswordAsync(password: string, stored: string | null | undefined): Promise<boolean> {
  const h = parse(stored);
  if (!h) return false;
  try {
    return matches(h.key, await scryptAsync(password, h.salt, h.key.length, opts(h)));
  } catch {
    return false;
  }
}

// Whether a hash was made with weaker settings than today's, so a successful
// sign-in should store a fresh one.
export function needsRehash(stored: string | null | undefined): boolean {
  const h = parse(stored);
  return !h || h.N !== COST.N || h.r !== COST.r || h.p !== COST.p || h.key.length !== KEYLEN;
}

// Checking a hash made with cheaper, older settings takes less time than
// checking one made today, and an unknown username is checked against a
// today's-cost dummy. So after a failed check, the caller makes up the
// missing work, or the quicker refusal would mark a real username. scrypt's
// time is linear in N·r·p, so the gap is filled with that much more p.
export function paddingFor(stored: string | null | undefined): { N: number; r: number; p: number } | null {
  const h = parse(stored);
  if (!h) return { ...COST };
  const p = Math.round((COST.N * COST.r * COST.p - h.N * h.r * h.p) / (COST.N * COST.r));
  return p >= 1 ? { N: COST.N, r: COST.r, p } : null;
}

const PAD_SALT = Buffer.alloc(16);

export async function padVerifyWork(password: string, stored: string | null | undefined): Promise<void> {
  const c = paddingFor(stored);
  if (c) await scryptAsync(password, PAD_SALT, KEYLEN, opts(c)).catch(() => undefined);
}

// Usernames are an identity key, so they are compared in one canonical form.
export const normalizeUsername = (raw: string): string => raw.trim().toLowerCase();
