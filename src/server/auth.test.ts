import { describe, expect, it } from "vitest";
import { signSession, verifySession } from "./auth";

const key = "ab".repeat(32);
const other = "cd".repeat(32);

describe("session", () => {
  it("round-trips the user id", () => {
    expect(verifySession(signSession(7, key), key)).toBe(7);
  });

  it("distinguishes users — a session is not interchangeable between accounts", () => {
    expect(verifySession(signSession(1, key), key)).toBe(1);
    expect(verifySession(signSession(2, key), key)).toBe(2);
  });

  it("rejects a forged user id", () => {
    const [, exp, sig] = signSession(1, key).split(".");
    expect(verifySession(`2.${exp}.${sig}`, key)).toBeNull();
  });

  it("rejects tampering", () => {
    expect(verifySession(signSession(1, key) + "0", key)).toBeNull();
  });

  it("rejects expired", () => {
    expect(verifySession(signSession(1, key, -1000), key)).toBeNull();
  });

  it("rejects a session signed with a different secret", () => {
    expect(verifySession(signSession(1, other), key)).toBeNull();
  });

  it("rejects undefined and malformed values", () => {
    expect(verifySession(undefined, key)).toBeNull();
    expect(verifySession("", key)).toBeNull();
    expect(verifySession("garbage", key)).toBeNull();
    expect(verifySession("1.2", key)).toBeNull();
  });

  // Pre-multi-user cookies were "exp.mac" with no user id. They must not be
  // honoured as some default account once sessions carry identity.
  it("rejects a legacy two-part session", () => {
    expect(verifySession("9999999999999.deadbeef", key)).toBeNull();
  });

  it("rejects a non-numeric user id", () => {
    expect(verifySession(`x.${Date.now() + 1000}.deadbeef`, key)).toBeNull();
  });
});
