import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import nextConfig from "../../next.config";
import { proxy } from "../proxy";
import { signSession } from "./auth";
import { pagePolicy } from "./csp";

// The headers next.config.ts sends. The study guide renders course text as
// markdown, so the page policy is what stops an image tag in it from sending
// data to another site.
async function rules() {
  const all = await nextConfig.headers!();
  const find = (key: string) => all.find((r) => r.headers.some((h) => h.key === key));
  const value = (key: string) => find(key)?.headers.find((h) => h.key === key)?.value;
  return { find, value };
}

const directives = (policy: string) => Object.fromEntries(policy.split("; ").map((d) => {
  const [name, ...rest] = d.split(" ");
  return [name, rest.join(" ")];
}));

describe("security headers", () => {
  it("keeps the site out of other sites' frames, on every response", async () => {
    const { find, value } = await rules();
    expect(find("X-Frame-Options")!.source).toBe("/:path*");
    expect(value("X-Frame-Options")).toBe("DENY");
    expect(value("X-Content-Type-Options")).toBe("nosniff");
    expect(value("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
  });

  // Two policies would both apply, and the static one would block the nonce'd scripts' loads.
  it("leaves the page policy to the proxy", async () => {
    expect((await rules()).find("Content-Security-Policy")).toBeUndefined();
  });
});

describe("the page policy", () => {
  it("lets pages load images only from this site", () => {
    const csp = directives(pagePolicy("abc", false));
    expect(csp["img-src"]).toBe("'self' data: blob:");
    expect(csp["frame-ancestors"]).toBe("'none'");
    expect(csp["connect-src"]).toBe("'self'");
    expect(csp["object-src"]).toBe("'none'");
  });

  // An injected <script> or onclick= has no nonce, so it never runs.
  it("runs only scripts with this response's nonce, and never string eval outside development", () => {
    const script = directives(pagePolicy("abc", false))["script-src"]!.split(" ");
    expect(script).toContain("'nonce-abc'");
    expect(script).toContain("'strict-dynamic'");
    expect(script).not.toContain("'unsafe-inline'");
    expect(script).not.toContain("'unsafe-eval'");
    expect(directives(pagePolicy("abc", true))["script-src"]).toContain("'unsafe-eval'");
  });
});

describe("the proxy's policy", () => {
  const key = "ab".repeat(32);
  beforeEach(() => { vi.stubEnv("SECRET_KEY", key); vi.stubEnv("SESSION_KEY", undefined); });
  afterEach(() => { vi.unstubAllEnvs(); });
  const get = (path: string) => proxy(new NextRequest(`http://x${path}`, { headers: { cookie: `session=${signSession(1, key)}` } }));
  const nonceOf = (res: Response) => /'nonce-([^']+)'/.exec(res.headers.get("Content-Security-Policy") ?? "")?.[1];

  it("gives every page response a policy with a fresh nonce, and hands the same nonce to the page", () => {
    const a = get("/modules/3/guide"), b = get("/modules/3/guide");
    expect(nonceOf(a)).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(nonceOf(a)).not.toBe(nonceOf(b));
    // NextResponse.next({ request }) passes the request's new headers on this way.
    expect(a.headers.get("x-middleware-request-x-nonce")).toBe(nonceOf(a));
    expect(a.headers.get("x-middleware-request-content-security-policy")).toBe(a.headers.get("Content-Security-Policy"));
  });

  it("puts it on the sign-in page too, and not on the API", () => {
    expect(nonceOf(proxy(new NextRequest("http://x/login")))).toBeTruthy();
    expect(get("/api/modules/3/files/9").headers.get("Content-Security-Policy")).toBeNull();
    expect(proxy(new NextRequest("http://x/api/health")).headers.get("Content-Security-Policy")).toBeNull();
  });
});
