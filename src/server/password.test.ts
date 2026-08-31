import { describe, expect, it } from "vitest";
import { hashPassword, normalizeUsername, verifyPassword } from "./password";

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

  it("carries its parameters so they can be raised later", () => {
    expect(hashPassword("x").split("$").slice(0, 4)).toEqual(["scrypt", "16384", "8", "1"]);
  });

  it("treats a missing or malformed hash as a failure, not a crash", () => {
    for (const bad of [null, undefined, "", "notahash", "scrypt$1$2$3", "bcrypt$a$b$c$d$e", "scrypt$N$8$1$zz$zz"]) {
      expect(verifyPassword("anything", bad as string | null)).toBe(false);
    }
  });

  it("is case- and whitespace-insensitive on usernames", () => {
    expect(normalizeUsername("  MjyKxz17 ")).toBe("mjykxz17");
  });
});
