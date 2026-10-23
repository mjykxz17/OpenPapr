import { describe, expect, it } from "vitest";
import { mailConnected, mailEnabled } from "./mail-access";

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

describe("mailConnected", () => {
  const app = { MS_CLIENT_ID: "0f1e2d3c-aaaa-bbbb-cccc-123456789abc" };
  it("counts Outlook only when the instance has the app and the user has connected", () => {
    expect(mailConnected(app, { msRefreshTokenEnc: "enc" })).toBe(true);
    expect(mailConnected(app, { msRefreshTokenEnc: null })).toBe(false);
    expect(mailConnected(app, undefined)).toBe(false);
  });
  it("ignores a token left over after the Outlook app was removed", () => {
    expect(mailConnected({}, { msRefreshTokenEnc: "enc" })).toBe(false);
  });
});
