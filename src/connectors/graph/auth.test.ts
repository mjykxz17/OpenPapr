import { describe, expect, it, vi } from "vitest";
import { refreshAccessToken } from "./auth";

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });

describe("refreshAccessToken", () => {
  it("posts the refresh grant and returns rotated tokens", async () => {
    const fetchFn = vi.fn(async () => json({ access_token: "at2", refresh_token: "rt2" }));
    const out = await refreshAccessToken("cid", "rt1", fetchFn as never);
    expect(out).toEqual({ accessToken: "at2", refreshToken: "rt2" });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/organizations/oauth2/v2.0/token");
    const body = init.body as URLSearchParams;
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("rt1");
    expect(body.get("scope")).toBe("offline_access Mail.Read");
  });
  it("keeps the old refresh token if the response omits one", async () => {
    const fetchFn = vi.fn(async () => json({ access_token: "at2" }));
    expect((await refreshAccessToken("cid", "rt1", fetchFn as never)).refreshToken).toBe("rt1");
  });
  it("throws on error responses", async () => {
    const fetchFn = vi.fn(async () => json({ error: "invalid_grant", error_description: "expired" }, 400));
    await expect(refreshAccessToken("cid", "rt1", fetchFn as never)).rejects.toThrow(/invalid_grant/);
  });
});
