import { describe, expect, it } from "vitest";
import { signSession, verifySession } from "./auth";
const key = "ab".repeat(32);
describe("session", () => {
  it("round-trips", () => expect(verifySession(signSession(key), key)).toBe(true));
  it("rejects tampering", () => expect(verifySession(signSession(key) + "0", key)).toBe(false));
  it("rejects expired", () => expect(verifySession(signSession(key, -1000), key)).toBe(false));
  it("rejects undefined", () => expect(verifySession(undefined, key)).toBe(false));
});
