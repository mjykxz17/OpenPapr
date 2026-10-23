import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { readSession, signSession, verifySession } from "./auth";

const key = "ab".repeat(32);
const other = "cd".repeat(32);

// A cookie as signed before session versions existed: "<userId>.<exp>.<mac>".
const legacy = (userId: number, exp = Date.now() + 60_000) => {
  const payload = `${userId}.${exp}`;
  return `${payload}.${createHmac("sha256", Buffer.from(key, "hex")).update(payload).digest("hex")}`;
};

describe("session", () => {
  it("round-trips the user id", () => {
    expect(verifySession(signSession(7, key), key)).toBe(7);
  });

  it("round-trips the session version", () => {
    expect(readSession(signSession(7, key, 60_000, 3), key)).toEqual({ userId: 7, version: 3 });
    expect(readSession(signSession(7, key), key)).toEqual({ userId: 7, version: 0 });
  });

  it("distinguishes users — a session is not interchangeable between accounts", () => {
    expect(verifySession(signSession(1, key), key)).toBe(1);
    expect(verifySession(signSession(2, key), key)).toBe(2);
  });

  it("rejects a forged user id", () => {
    const [, v, exp, sig] = signSession(1, key).split(".");
    expect(verifySession(`2.${v}.${exp}.${sig}`, key)).toBeNull();
  });

  // Otherwise a signed-out cookie could be edited back to the current version.
  it("rejects a forged version", () => {
    const [id, , exp, sig] = signSession(1, key, 60_000, 0).split(".");
    expect(readSession(`${id}.1.${exp}.${sig}`, key)).toBeNull();
  });

  it("rejects tampering", () => {
    expect(verifySession(signSession(1, key) + "0", key)).toBeNull();
  });

  it("rejects expired", () => {
    expect(verifySession(signSession(1, key, -1000), key)).toBeNull();
    expect(verifySession(legacy(1, Date.now() - 1000), key)).toBeNull();
  });

  it("rejects a session signed with a different secret", () => {
    expect(verifySession(signSession(1, other), key)).toBeNull();
  });

  // An unset key must not turn into "anything signed with an empty key".
  it("rejects everything when there is no key", () => {
    expect(verifySession(signSession(1, ""), "")).toBeNull();
  });

  it("rejects undefined and malformed values", () => {
    expect(verifySession(undefined, key)).toBeNull();
    expect(verifySession("", key)).toBeNull();
    expect(verifySession("garbage", key)).toBeNull();
    expect(verifySession("1.2", key)).toBeNull();
    expect(verifySession("1.2.3.4.5", key)).toBeNull();
  });

  // Cookies issued before versions existed keep working, as version 0, so the
  // deploy that added versions signed nobody out.
  it("reads a cookie from before versions as version 0", () => {
    expect(readSession(legacy(5), key)).toEqual({ userId: 5, version: 0 });
  });

  // Pre-multi-user cookies were "exp.mac" with no user id. They must not be
  // honoured as some default account once sessions carry identity.
  it("rejects a legacy two-part session", () => {
    expect(verifySession("9999999999999.deadbeef", key)).toBeNull();
  });

  it("rejects a non-numeric user id or version", () => {
    expect(verifySession(`x.${Date.now() + 1000}.deadbeef`, key)).toBeNull();
    expect(verifySession(`1.x.${Date.now() + 1000}.deadbeef`, key)).toBeNull();
  });
});
