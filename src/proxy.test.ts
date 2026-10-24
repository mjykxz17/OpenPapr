import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { signSession } from "./server/auth";
import { proxy } from "./proxy";

const key = "ab".repeat(32);
const get = (path: string, session?: string) =>
  proxy(new NextRequest(`http://x${path}`, { headers: session ? { cookie: `session=${session}` } : {} }));
// NextResponse.next() marks the response so Next carries on to the route.
const passed = (res: Response) => res.headers.get("x-middleware-next") === "1";

beforeEach(() => {
  vi.stubEnv("SECRET_KEY", key);
  vi.stubEnv("SESSION_KEY", undefined);
});
afterEach(() => { vi.unstubAllEnvs(); });

describe("proxy", () => {
  it("lets a signed, unexpired session through", () => {
    expect(passed(get("/", signSession(1, key)))).toBe(true);
    expect(passed(get("/api/tasks", signSession(1, key, 60_000, 3)))).toBe(true);
  });

  it("sends a page visit without a session to sign in, and answers an API call with 401", () => {
    const page = get("/modules/1");
    expect(page.status).toBe(307);
    expect(page.headers.get("location")).toBe("http://x/login");
    expect(get("/api/tasks").status).toBe(401);
  });

  it("refuses expired and forged sessions", () => {
    expect(get("/", signSession(1, key, -1000)).status).toBe(307);
    expect(get("/", signSession(1, "cd".repeat(32))).status).toBe(307);
  });

  it("uses SESSION_KEY when it is set", () => {
    const sessionKey = "ef".repeat(32);
    vi.stubEnv("SESSION_KEY", sessionKey);
    expect(passed(get("/", signSession(1, sessionKey)))).toBe(true);
    expect(passed(get("/", signSession(1, key)))).toBe(false);
  });

  it("leaves sign-in, the demo, health, calendar feeds and the MCP server open", () => {
    for (const p of ["/login", "/api/login", "/api/demo", "/api/health", "/api/calendar/feed/abc.ics", "/api/mcp"]) expect(passed(get(p))).toBe(true);
  });

  it("does not open look-alike paths", () => {
    expect(get("/login-help").status).toBe(307);
    expect(get("/api/healthz").status).toBe(401);
    expect(get("/api/mcp/x").status).toBe(401);
  });
});
