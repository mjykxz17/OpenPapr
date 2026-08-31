import { describe, expect, it } from "vitest";
import { createDb } from "./client";
import { users } from "./schema";
import { findByUsername, setCredentials } from "./repo";
import { hashPassword, verifyPassword } from "../server/password";

const setup = (n = 2) => {
  const db = createDb(":memory:");
  for (let i = 0; i < n; i++) db.insert(users).values({ name: `u${i}` }).run();
  return db;
};

describe("setCredentials", () => {
  it("stores a username and a verifiable hash", () => {
    const db = setup();
    expect(setCredentials(db, 1, "aiden", hashPassword("s3cret"))).toBe(true);
    const row = findByUsername(db, "aiden")!;
    expect(row.id).toBe(1);
    expect(verifyPassword("s3cret", row.passwordHash)).toBe(true);
    expect(verifyPassword("wrong", row.passwordHash)).toBe(false);
  });

  it("refuses a username another account already holds", () => {
    const db = setup();
    setCredentials(db, 1, "aiden", hashPassword("a"));
    expect(setCredentials(db, 2, "aiden", hashPassword("b"))).toBe(false);
    expect(findByUsername(db, "aiden")!.id).toBe(1);
  });

  it("lets an account change its own password without losing its name", () => {
    const db = setup();
    setCredentials(db, 1, "aiden", hashPassword("old"));
    expect(setCredentials(db, 1, "aiden", hashPassword("new"))).toBe(true);
    expect(verifyPassword("new", findByUsername(db, "aiden")!.passwordHash)).toBe(true);
  });

  it("returns nothing for an unknown username", () => {
    expect(findByUsername(setup(), "nobody")).toBeUndefined();
  });
});
