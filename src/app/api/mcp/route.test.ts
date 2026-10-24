import { describe, expect, it, vi } from "vitest";
import { createDb } from "@/db/client";
import { users } from "@/db/schema";
import { makeMcpKey } from "@/server/mcp/token";

const db = createDb(":memory:");
db.insert(users).values({ name: "Aiden" }).run();
const key = makeMcpKey(db, 1, Date.now());
vi.mock("@/server/db", () => ({ getDb: () => db }));

const { POST, GET } = await import("./route");

const post = (body: unknown, headers: Record<string, string> = { authorization: `Bearer ${key}` }) =>
  POST(new Request("http://localhost:3000/api/mcp", { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) }));

describe("/api/mcp", () => {
  it("turns away a request without a good key", async () => {
    const res = await post({ jsonrpc: "2.0", id: 1, method: "ping" }, {});
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toMatch(/^Bearer/);
    expect((await post({ jsonrpc: "2.0", id: 1, method: "ping" }, { authorization: "Bearer opk_wrong" })).status).toBe(401);
  });
  it("turns away a web page from another site, even with the key", async () => {
    expect((await post({ jsonrpc: "2.0", id: 1, method: "ping" }, { authorization: `Bearer ${key}`, origin: "https://evil.example" })).status).toBe(403);
  });
  it("answers a request with JSON, a notification with 202, and garbage with a parse error", async () => {
    const res = await post({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: number; result: { tools: { name: string }[] } };
    expect(body.id).toBe(1);
    expect(body.result.tools.map((t) => t.name)).toContain("read_file");
    expect((await post({ jsonrpc: "2.0", method: "notifications/initialized" })).status).toBe(202);
    expect((await post("{not json")).status).toBe(400);
  });
  it("answers each message of a batch", async () => {
    const res = await post([{ jsonrpc: "2.0", id: 1, method: "ping" }, { jsonrpc: "2.0", method: "notifications/initialized" }, { jsonrpc: "2.0", id: 2, method: "ping" }]);
    expect(((await res.json()) as { id: number }[]).map((r) => r.id)).toEqual([1, 2]);
  });
  it("has no event stream to open", () => {
    expect(GET().status).toBe(405);
  });
});
