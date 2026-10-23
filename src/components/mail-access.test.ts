import { describe, expect, it } from "vitest";
import { mailEnabled } from "./mail-access";

describe("mailEnabled", () => {
  it("is off when the instance has no Outlook app", () => {
    expect(mailEnabled({})).toBe(false);
    expect(mailEnabled({ MS_CLIENT_ID: "" })).toBe(false);
    expect(mailEnabled({ MS_CLIENT_ID: "   " })).toBe(false);
  });
  it("is on once an Outlook app id is set", () => {
    expect(mailEnabled({ MS_CLIENT_ID: "0f1e2d3c-aaaa-bbbb-cccc-123456789abc" })).toBe(true);
  });
});
