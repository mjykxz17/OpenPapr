import { describe, expect, it } from "vitest";
import { parseUserArg } from "./cli";

describe("parseUserArg", () => {
  it("defaults to 1 when --user flag is omitted", () => {
    expect(parseUserArg(["node", "script.ts"])).toBe(1);
  });
  it("parses --user 2", () => {
    expect(parseUserArg(["node", "script.ts", "--user", "2"])).toBe(2);
  });
  it("throws on non-integer value", () => {
    expect(() => parseUserArg(["node", "script.ts", "--user", "abc"])).toThrow(/Invalid --user value/);
  });
  it("throws when --user flag has no value", () => {
    expect(() => parseUserArg(["node", "script.ts", "--user"])).toThrow(/Invalid --user value/);
  });
});
