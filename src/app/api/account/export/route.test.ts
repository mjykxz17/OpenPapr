import { describe, expect, it, vi } from "vitest";
import { createDb } from "@/db/client";
import { users } from "@/db/schema";

const db = createDb(":memory:");
db.insert(users).values([{ name: "Alex", isDemo: true }, { name: "Real" }]).run();
let signedIn = 1;
vi.mock("@/server/db", () => ({ getDb: () => db }));
vi.mock("@/server/session", async (real) => ({
  ...(await real<typeof import("@/server/session")>()),
  currentUserId: async () => signedIn,
}));

const { GET } = await import("./route");

describe("GET /api/account/export", () => {
  // Opened from a plain link, so the demo's refusal is a sentence, not JSON.
  it("tells a demo visitor in plain words that there is nothing to download", async () => {
    signedIn = 1;
    const res = await GET();
    expect(res.status).toBe(403);
    expect(res.headers.get("content-type")).toMatch(/^text\/plain/);
    expect(await res.text()).toMatch(/shared demo account/);
  });

  it("hands anyone else their data as a JSON file", async () => {
    signedIn = 2;
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toMatch(/attachment/);
  });
});
