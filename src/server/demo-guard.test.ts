import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { createDb } from "@/db/client";
import { users } from "@/db/schema";
import { DEMO_NO_OUTLOOK, demoLocked, isDemoUser } from "./demo-guard";
import { beginGraphConnect } from "./graph-connect";

const db = () => {
  const d = createDb(":memory:");
  d.insert(users).values([{ name: "Alex", isDemo: true }, { name: "Real" }]).run();
  return d;
};

describe("demoLocked", () => {
  it("refuses the demo account and lets anyone else through", async () => {
    const d = db();
    expect(isDemoUser(1, d)).toBe(true);
    const res = demoLocked(1, "nope", d);
    expect(res?.status).toBe(403);
    expect(await res?.json()).toEqual({ error: "nope" });
    expect(demoLocked(2, "nope", d)).toBeNull();
    expect(demoLocked(99, "nope", d)).toBeNull();
  });
});

describe("beginGraphConnect", () => {
  // Every visitor shares the demo account, so a mailbox linked to it would be
  // readable by all of them.
  it("will not start linking Outlook for the demo account", async () => {
    await expect(beginGraphConnect(1, Date.now(), db())).rejects.toThrow(DEMO_NO_OUTLOOK);
  });
});

// Every route that changes something, and whether the shared demo account may
// call it. "open" is what the demo is there to show and the nightly reset
// undoes; "locked" reaches past the demo's day (linked accounts, keys,
// passwords, deleting, exporting, rebuilds that cost a model call).
// A new route has to be added here, which is the point: someone decides.
const AUDIT: Record<string, "open" | "locked"> = {
  "account/about": "locked", // accountRequest
  "account/canvas": "locked", // accountRequest
  "account/delete": "locked",
  "account/export": "locked", // a GET, but it hands out what other visitors typed
  "account/llm": "locked", // accountRequest
  "account/onboarded": "locked", // accountRequest
  "account/password": "locked", // accountRequest
  "account/sessions/revoke": "locked", // accountRequest; would sign every visitor out
  "calendar": "locked", // a feed link would outlive the reset
  "changes": "open",
  "changes/[id]": "open",
  "components/manual": "open",
  "demo": "open", // the way in
  "graph/connect": "locked", // GET too: a finished poll stores the mailbox token
  "graph/disconnect": "locked",
  "home-layout": "open",
  "items/[id]/dismiss": "open",
  "login": "open",
  "logout": "open",
  "modules/[id]/guide": "open", // the worker never spends a model call on the demo
  "modules/[id]/guide/progress": "open", // chapters read; the reset clears them
  "modules/[id]/guide/quiz": "open",
  "modules/[id]/guide/quiz/answer": "open", // quiz answers; the reset clears them
  "modules/[id]/hidden": "open",
  "modules/[id]/lecturers": "locked", // accountRequest; the worker would fetch the page
  "modules/[id]/notes": "open",
  "modules/[id]/seen": "open",
  "modules/order": "open",
  "pet/chat": "open", // asking; the demo's chats are not saved
  "pet/sessions/[id]": "open",
  "profile": "locked", // accountRequest; a rebuild
  "seen": "open",
  "sync": "open", // no Canvas token, so the worker has nothing to do
  "tasks": "open",
  "tasks/[id]": "open",
};

// GETs that change something or hand out data, so they are locked too.
const LOCKED_GETS = new Set(["account/export", "graph/connect"]);

const API = join(process.cwd(), "src", "app", "api");
function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return routeFiles(p);
    return f === "route.ts" ? [p] : [];
  });
}
const routeName = (p: string) => relative(API, p).replace(/\/route\.ts$/, "");

describe("demo audit of the API routes", () => {
  const routes = routeFiles(API).map((p) => ({ name: routeName(p), src: readFileSync(p, "utf8") }));

  it("covers every route that changes something", () => {
    const changing = routes.filter((r) => /export (async )?function (POST|PUT|PATCH|DELETE)\b/.test(r.src)).map((r) => r.name);
    expect(changing.filter((n) => !(n in AUDIT))).toEqual([]);
  });

  it("locks every route marked locked, in each of its handlers", () => {
    for (const [name, rule] of Object.entries(AUDIT)) {
      const route = routes.find((r) => r.name === name);
      expect(route, name).toBeDefined();
      if (rule !== "locked") continue;
      const methods = LOCKED_GETS.has(name) ? "GET|POST|PUT|PATCH|DELETE" : "POST|PUT|PATCH|DELETE";
      const handlers = route!.src.match(new RegExp(`export (async )?function (${methods})\\b`, "g"))?.length ?? 0;
      expect(handlers, name).toBeGreaterThan(0);
      const guards = route!.src.match(/demoLocked\(|isDemoUser\(|accountRequest\(/g)?.length ?? 0;
      expect(guards, name).toBeGreaterThanOrEqual(handlers);
    }
  });
});
