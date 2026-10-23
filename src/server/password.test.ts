import { describe, expect, it } from "vitest";
import { hashPassword, hashPasswordAsync, needsRehash, normalizeUsername, paddingFor, verifyPassword, verifyPasswordAsync } from "./password";

// "correct horse" as hashed before the cost was raised (N=2^14, r=8, p=1).
const OLD_HASH = "scrypt$16384$8$1$00112233445566778899aabbccddeeff$f5206d570fcd120bd1f23a8cd186bd87c04ac1db00e9ac1efca589774ae6ecb894992b7ee89035d39ef675dceec6f03c56434def62315db0afa7af5990f9b57b";

describe("password hashing", () => {
  it("accepts the right password", () => {
    expect(verifyPassword("correct horse", hashPassword("correct horse"))).toBe(true);
  });

  it("rejects the wrong one", () => {
    expect(verifyPassword("wrong", hashPassword("correct horse"))).toBe(false);
  });

  it("never stores the password itself", () => {
    expect(hashPassword("hunter2")).not.toContain("hunter2");
  });

  it("salts, so the same password hashes differently every time", () => {
    expect(hashPassword("same")).not.toBe(hashPassword("same"));
  });

  // OWASP's N=2^14, r=8, p=5: 16 MiB a hash, inside Node's default maxmem.
  it("uses an OWASP-listed cost and carries it in the hash", () => {
    expect(hashPassword("x").split("$").slice(0, 4)).toEqual(["scrypt", "16384", "8", "5"]);
  });

  it("the async versions agree with the sync ones", async () => {
    const h = await hashPasswordAsync("correct horse");
    expect(h.split("$").slice(0, 4)).toEqual(["scrypt", "16384", "8", "5"]);
    expect(verifyPassword("correct horse", h)).toBe(true);
    expect(await verifyPasswordAsync("correct horse", hashPassword("correct horse"))).toBe(true);
    expect(await verifyPasswordAsync("wrong", h)).toBe(false);
  });

  it("still verifies hashes made with the old, cheaper cost", async () => {
    expect(verifyPassword("correct horse", OLD_HASH)).toBe(true);
    expect(await verifyPasswordAsync("correct horse", OLD_HASH)).toBe(true);
    expect(await verifyPasswordAsync("wrong", OLD_HASH)).toBe(false);
  });

  it("asks for a rehash only when the hash is weaker than today's", () => {
    expect(needsRehash(OLD_HASH)).toBe(true);
    expect(needsRehash(hashPassword("x"))).toBe(false);
  });

  // Checking the old hash plus the padding must cost what checking a
  // today's hash costs: scrypt time is linear in N·r·p.
  it("pads a check against an older hash up to today's work, and no further", () => {
    const work = (c: { N: number; r: number; p: number } | null) => (c ? c.N * c.r * c.p : 0);
    const today = 16384 * 8 * 5;
    expect(16384 * 8 * 1 + work(paddingFor(OLD_HASH))).toBe(today);
    expect(paddingFor(hashPassword("x"))).toBeNull();
    // A hash that cannot be read is checked with no work at all.
    expect(work(paddingFor("notahash"))).toBe(today);
  });

  it("treats a missing or malformed hash as a failure, not a crash", async () => {
    for (const bad of [null, undefined, "", "notahash", "scrypt$1$2$3", "bcrypt$a$b$c$d$e", "scrypt$N$8$1$zz$zz", "scrypt$3$8$1$00$00"]) {
      expect(verifyPassword("anything", bad as string | null)).toBe(false);
      expect(await verifyPasswordAsync("anything", bad as string | null)).toBe(false);
    }
  });

  // A corrupted row asking for gigabytes must be refused, not attempted.
  it("refuses a stored cost beyond the memory cap", async () => {
    const huge = OLD_HASH.replace("$16384$", "$1048576$");
    expect(verifyPassword("correct horse", huge)).toBe(false);
    expect(await verifyPasswordAsync("correct horse", huge)).toBe(false);
  });

  it("is case- and whitespace-insensitive on usernames", () => {
    expect(normalizeUsername("  MjyKxz17 ")).toBe("mjykxz17");
  });
});
