import { describe, expect, it } from "vitest";
import { decrypt, encrypt } from "./crypto";

const key = "ab".repeat(32);

describe("crypto", () => {
  it("round-trips", () => {
    expect(decrypt(encrypt("secret token", key), key)).toBe("secret token");
  });
  it("produces different ciphertexts per call (random IV)", () => {
    expect(encrypt("x", key)).not.toBe(encrypt("x", key));
  });
  it("throws on tampered payload", () => {
    const p = Buffer.from(encrypt("x", key), "base64");
    p[p.length - 1] ^= 0xff;
    expect(() => decrypt(p.toString("base64"), key)).toThrow();
  });
  it("throws on wrong key", () => {
    expect(() => decrypt(encrypt("x", key), "cd".repeat(32))).toThrow();
  });
});
