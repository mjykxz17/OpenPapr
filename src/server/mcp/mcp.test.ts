import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { createDb } from "@/db/client";
import { files, items, modules, passages, slideNotes, studyGuides, tasks, users } from "@/db/schema";
import { deckCachePath } from "../deck";
import { originalCachePath } from "../files";
import { handleRpc, ToolError, text, type Tool } from "./protocol";
import { makeMcpKey, removeMcpKey, userForMcpKey } from "./token";
import { INSTRUCTIONS, MAX_CHARS, TOOLS, type Ctx } from "./tools";

const SERVER = { name: "openpapr", version: "test", instructions: INSTRUCTIONS };
const now = Date.parse("2026-10-20T10:00:00+08:00");

describe("keys", () => {
  const db = createDb(":memory:");
  db.insert(users).values([{ name: "a" }, { name: "b" }, { name: "demo", isDemo: true }]).run();

  it("finds the account a key belongs to, and only that one", () => {
    const a = makeMcpKey(db, 1, now);
    const b = makeMcpKey(db, 2, now);
    expect(a).toMatch(/^opk_[A-Za-z0-9_-]{43}$/);
    expect(userForMcpKey(db, `Bearer ${a}`)).toBe(1);
    expect(userForMcpKey(db, `bearer ${b}`)).toBe(2);
    // Only the hash is stored.
    expect(db.select().from(users).all().some((u) => u.mcpTokenHash === a)).toBe(false);
  });
  it("refuses a missing, malformed or wrong key", () => {
    for (const h of [null, "", "Bearer", "Basic abc", "Bearer opk_nope", "Bearer x".padEnd(200, "x")]) expect(userForMcpKey(db, h)).toBeNull();
  });
  it("cuts off the old key when a new one is made or it is turned off", () => {
    const old = makeMcpKey(db, 1, now);
    const fresh = makeMcpKey(db, 1, now);
    expect(userForMcpKey(db, `Bearer ${old}`)).toBeNull();
    expect(userForMcpKey(db, `Bearer ${fresh}`)).toBe(1);
    removeMcpKey(db, 1);
    expect(userForMcpKey(db, `Bearer ${fresh}`)).toBeNull();
  });
  it("never lets the shared demo in", () => {
    expect(userForMcpKey(db, `Bearer ${makeMcpKey(db, 3, now)}`)).toBeNull();
  });
});

describe("protocol", () => {
  const echo: Tool<null> = {
    name: "echo", title: "Echo", description: "says it back",
    input: z.object({ say: z.string() }),
    run: (a: { say: string }) => { if (a.say === "oops") throw new ToolError("no oops"); if (a.say === "bug") throw new Error("x"); return text(a.say); },
  };
  const call = (msg: unknown) => handleRpc(msg, [echo], null, SERVER);

  it("agrees a protocol version and says it has tools", async () => {
    const r = await call({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } });
    expect(r?.result).toMatchObject({ protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "openpapr" } });
    const later = await call({ jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "2099-01-01" } });
    expect((later?.result as { protocolVersion: string }).protocolVersion).toBe("2025-11-25");
  });
  it("answers no notification", async () => {
    expect(await call({ jsonrpc: "2.0", method: "notifications/initialized" })).toBeNull();
  });
  it("lists tools with their JSON schemas, all read-only", async () => {
    const r = await call({ jsonrpc: "2.0", id: 3, method: "tools/list" });
    const [t] = (r?.result as { tools: { name: string; inputSchema: Record<string, unknown>; annotations: { readOnlyHint: boolean } }[] }).tools;
    expect(t).toMatchObject({ name: "echo", inputSchema: { type: "object", properties: { say: { type: "string" } }, required: ["say"] }, annotations: { readOnlyHint: true } });
    expect(t!.inputSchema.$schema).toBeUndefined();
  });
  it("runs a tool, and turns bad arguments and failures into answers the model can read", async () => {
    const run = async (args: unknown) => (await call({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "echo", arguments: args } }))?.result as { content: { text: string }[]; isError?: boolean };
    expect(await run({ say: "hi" })).toEqual({ content: [{ type: "text", text: "hi" }] });
    expect(await run({ say: 5 })).toMatchObject({ isError: true });
    expect(await run({ say: "oops" })).toMatchObject({ isError: true, content: [{ text: "no oops" }] });
    const bug = await run({ say: "bug" });
    expect(bug.isError).toBe(true);
    expect(bug.content[0]!.text).not.toContain("x");
  });
  it("errors on an unknown tool or method, and on what is not JSON-RPC", async () => {
    expect((await call({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "nope" } }))?.error?.code).toBe(-32602);
    expect((await call({ jsonrpc: "2.0", id: 6, method: "resources/list" }))?.error?.code).toBe(-32601);
    expect((await call({ id: 7, method: "ping" }))?.error?.code).toBe(-32600);
    expect((await call("hello"))?.error?.code).toBe(-32600);
    expect((await call({ jsonrpc: "2.0", id: 8, method: "ping" }))?.result).toEqual({});
  });
});

// Two students in one course, so every tool is checked against reading the other's.
describe("tools", () => {
  const saved = process.env.DATABASE_PATH;
  const dir = mkdtempSync(join(tmpdir(), "mcp-test-"));
  const db = createDb(":memory:");
  let ctx: Ctx;
  let other: Ctx;

  beforeAll(() => {
    process.env.DATABASE_PATH = join(dir, "openpapr.db");
    db.insert(users).values([{ name: "Aiden", major: "Computer Science", studyYear: 3 }, { name: "Bea" }]).run();
    db.insert(modules).values([
      { userId: 1, canvasCourseId: 7, code: "CS3230", name: "CS3230 Design and Analysis of Algorithms [2610]", term: "AY26/27 S1" },
      { userId: 2, canvasCourseId: 7, code: "CS3230", name: "CS3230 Design and Analysis of Algorithms [2610]" },
      { userId: 1, canvasCourseId: 3, code: "CS1101S", name: "Programming Methodology", active: false },
    ]).run();
    db.insert(files).values([
      { moduleId: 1, canvasFileId: 101, displayName: "L4-master.pdf", category: "slides", sizeBytes: 90_000, discoveredAt: 1 },
      { moduleId: 1, canvasFileId: 102, displayName: "tut1.txt", category: "tutorial", discoveredAt: 1 },
      { moduleId: 1, canvasFileId: 103, displayName: "tut1.txt", category: "tutorial", discoveredAt: 2 },
      { moduleId: 1, canvasFileId: 104, displayName: "lecture.mp4", discoveredAt: 1 },
      { moduleId: 2, canvasFileId: 201, displayName: "bea-secret.txt", discoveredAt: 1 },
    ]).run();
    // Already on the volume, so nothing goes to Canvas.
    const deck = deckCachePath(7, "L4-master.pdf");
    mkdirSync(dirname(deck), { recursive: true });
    copyFileSync(join(process.cwd(), "src/demo/decks/L4-master.pdf"), deck);
    writeFileSync(`${deck}.src`, "101");
    writeFileSync(`${deck}.opt`, "");
    for (const [course, id, body] of [[7, 103, "Question 1: solve T(n) = 2T(n/2) + n"], [7, 201, "Bea's own"]] as const) {
      mkdirSync(dirname(originalCachePath(course, id)), { recursive: true });
      writeFileSync(originalCachePath(course, id), body);
    }
    const chapter = (n: number) => `## ${n}. Chapter ${n}\n\n### Part\n\n${"word ".repeat(12_000)}`;
    db.insert(studyGuides).values([
      { moduleId: 1, markdown: `# Guide\n\nIntro.\n\n${chapter(1)}\n\n${chapter(2)}`, sourceNote: "1 deck", generatedAt: now },
      { moduleId: 2, markdown: "# Bea's guide", generatedAt: now },
    ]).run();
    db.insert(items).values([
      { userId: 1, moduleId: 1, type: "announcement", source: "canvas", sourceId: "a1", title: "Quiz 1 moved", body: "<p>Quiz 1 is now on <b>Friday</b>.</p>", sender: "Prof", sourceCreatedAt: now - 86_400_000, firstSeenAt: now },
      { userId: 1, moduleId: null, type: "email", source: "graph", sourceId: "e1", title: "Library fine", body: "Pay up", firstSeenAt: now - 2 * 86_400_000 },
      { userId: 2, moduleId: 2, type: "announcement", source: "canvas", sourceId: "b1", title: "Bea's announcement", firstSeenAt: now },
    ]).run();
    db.insert(tasks).values([
      { userId: 1, moduleId: 1, key: "q1", title: "Quiz 1", kind: "quiz", dueAt: now + 3 * 86_400_000, why: "announced", stepsJson: JSON.stringify([{ id: "s", text: "Revise L4", minutes: 30, doBy: "2026-10-21", done: false }]), createdAt: now, updatedAt: now },
      { userId: 2, moduleId: 2, key: "q1", title: "Bea's quiz", kind: "quiz", createdAt: now, updatedAt: now },
    ]).run();
    db.insert(slideNotes).values({ userId: 1, moduleId: 1, deck: "L4-master", page: 2, markdown: "remember case 2", updatedAt: now }).run();
    ctx = { db, userId: 1, now };
    other = { db, userId: 2, now };
  });
  afterAll(() => { process.env.DATABASE_PATH = saved; });

  const run = async (c: Ctx, name: string, args: Record<string, unknown> = {}) => {
    const r = await handleRpc({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, TOOLS, c, SERVER);
    const res = r!.result as { content: ({ type: "text"; text: string } | { type: "image"; data: string; mimeType: string })[]; isError?: boolean };
    return { ...res, text: res.content.filter((x) => x.type === "text").map((x) => (x as { text: string }).text).join("\n") };
  };

  it("gives an overview of the student's own semester", async () => {
    const r = await run(ctx, "overview");
    expect(r.text).toContain("# Aiden");
    expect(r.text).toContain("Computer Science, year 3");
    expect(r.text).toContain("CS3230 (id 1) — Design and Analysis of Algorithms");
    expect(r.text).toContain("Quiz 1 (task 1)");
    expect(r.text).toContain("Quiz 1 moved (item 1)");
    expect(r.text).not.toMatch(/Bea/);
  });

  it("lists modules, the past ones only when asked", async () => {
    expect((await run(ctx, "list_modules")).text).not.toContain("CS1101S");
    expect((await run(ctx, "list_modules", { include_past: true })).text).toContain("CS1101S");
    expect((await run(other, "list_modules")).text).not.toContain("CS1101S");
  });

  it("finds a module by code or id, only among the caller's", async () => {
    expect((await run(ctx, "get_module", { module: "cs3230" })).text).toContain("(id 1)");
    expect((await run(ctx, "get_module", { module: "2" }))).toMatchObject({ isError: true });
    expect((await run(other, "get_module", { module: "1" }))).toMatchObject({ isError: true });
  });

  it("lists each file name once, as its newest upload", async () => {
    const r = await run(ctx, "list_files", { module: "CS3230" });
    expect(r.text).toContain("#3 CS3230 · tut1.txt");
    expect(r.text).not.toContain("#2 ");
    expect(r.text).toContain("lecture.mp4");
    expect(r.text).not.toContain("bea-secret");
    expect((await run(ctx, "list_files", { category: "slides" })).text).toMatch(/^1 files/);
  });

  it("reads a deck page by page, and a range of it", async () => {
    const all = await run(ctx, "read_file", { file_id: 1 });
    expect(all.isError).toBeUndefined();
    expect(all.text).toMatch(/L4-master\.pdf \(#1\) — \d+ pages, showing 1–\d+/);
    expect(all.text).toContain("--- page 1 ---");
    expect(all.text.toLowerCase()).toContain("master");
    const some = await run(ctx, "read_file", { file_id: 1, from_page: 2, to_page: 2 });
    expect(some.text).toContain("--- page 2 ---");
    expect(some.text).not.toContain("--- page 1 ---");
    expect(some.text).not.toContain("--- page 3 ---");
  });

  it("draws a page as an image", async () => {
    const r = await run(ctx, "view_page", { file_id: 1, page: 1 });
    const img = r.content.find((c) => c.type === "image") as { data: string; mimeType: string };
    expect(img.mimeType).toBe("image/png");
    expect(Buffer.from(img.data, "base64").subarray(1, 4).toString()).toBe("PNG");
  }, 30_000);

  it("reads a text file, and refuses what it cannot read", async () => {
    expect((await run(ctx, "read_file", { file_id: 3 })).text).toContain("Question 1: solve T(n)");
    expect(await run(ctx, "read_file", { file_id: 4 })).toMatchObject({ isError: true });
  });

  it("never opens another student's file, page or item", async () => {
    for (const [name, args] of [["read_file", { file_id: 5 }], ["view_page", { file_id: 5, page: 1 }], ["read_item", { item_id: 3 }]] as const) {
      const r = await run(ctx, name, args);
      expect(r.isError).toBe(true);
      expect(r.text).not.toContain("Bea");
    }
    expect((await run(other, "read_file", { file_id: 1 })).isError).toBe(true);
  });

  it("gives a long guide as its contents, then chapter by chapter", async () => {
    const toc = await run(ctx, "read_guide", { module: "CS3230" });
    expect(toc.text).toContain("## Contents");
    expect(toc.text).toContain("2. Chapter 2");
    expect(toc.text.length).toBeLessThan(5000);
    const ch = await run(ctx, "read_guide", { module: "CS3230", chapter: 2 });
    expect(ch.text).toContain("chapter 2 of 2");
    expect(ch.text).toContain("## 2. Chapter 2");
    expect((await run(ctx, "read_guide", { module: "CS3230", chapter: "chapter 1" })).text).toContain("## 1. Chapter 1");
    expect(await run(ctx, "read_guide", { module: "CS3230", chapter: 9 })).toMatchObject({ isError: true });
  });

  it("cuts a long reply and says how to get the rest", async () => {
    const long = "x".repeat(MAX_CHARS + 10);
    db.update(studyGuides).set({ markdown: long }).where(eq(studyGuides.moduleId, 2)).run();
    const first = await run(other, "read_guide", { module: "CS3230" });
    expect(first.text).toContain("call again with offset=50000");
    const rest = await run(other, "read_guide", { module: "CS3230", offset: MAX_CHARS });
    expect(rest.text).toMatch(/x{10}$/);
  });

  it("lists and reads announcements and emails as text", async () => {
    const list = await run(ctx, "list_items");
    expect(list.text).toContain("item 1 · announcement · CS3230");
    expect(list.text).toContain("Quiz 1 is now on Friday.");
    expect(list.text).toContain("item 2 · email · —");
    expect(list.text).not.toContain("Bea");
    expect((await run(ctx, "list_items", { type: "email" })).text).not.toContain("Quiz 1");
    expect((await run(ctx, "read_item", { item_id: 1 })).text).toContain("from Prof");
  });

  it("lists tasks with their steps, and notes", async () => {
    const t = await run(ctx, "list_tasks");
    expect(t.text).toContain("## Quiz 1 (task 1)");
    expect(t.text).toContain("- [ ] Revise L4 (30 min, by 2026-10-21)");
    expect(t.text).not.toContain("Bea");
    expect((await run(ctx, "read_notes", { module: "CS3230", deck: "L4-master.pdf" })).text).toContain("remember case 2");
    expect((await run(other, "read_notes", { module: "CS3230" })).text).toMatch(/^No notes/);
  });

  it("searches the slides' words, pointing at the page to read", async () => {
    db.insert(passages).values([
      { userId: 1, moduleId: 1, kind: "slide", sourceKey: "slide:1:3", fileId: 1, deck: "L4-master", page: 3, title: "L4-master · slide 3", body: "Case 2 of the master theorem", hash: "h", updatedAt: now },
      { userId: 2, moduleId: 2, kind: "slide", sourceKey: "slide:5:1", fileId: 5, deck: "bea", page: 1, title: "bea · slide 1", body: "Bea's master theorem notes", hash: "h", updatedAt: now },
    ]).run();
    const r = await run(ctx, "search", { query: "master theorem" });
    expect(r.text).toContain("→ read_file file_id=1 from_page=3");
    expect(r.text).not.toContain("Bea");
  });

  it("reads an assignment's Canvas page, with the files it links to", async () => {
    const id = db.insert(items).values({ userId: 1, moduleId: 1, type: "assignment", source: "canvas", sourceId: "assignment:50", title: "PS3",
      body: '<p>Prove the recurrence. Template: <a href="/courses/7/files/101/download">L4-master.pdf</a>, and <a href="/courses/7/files/201">not yours</a>.</p>', firstSeenAt: now }).returning().get().id;
    db.insert(passages).values({ userId: 1, moduleId: 1, kind: "assignment", sourceKey: `asg:${id}`, itemId: id, title: "Assignment: PS3", body: "Prove the recurrence.", hash: "h", updatedAt: now }).run();
    const r = await run(ctx, "read_item", { item_id: id });
    expect(r.text).toContain("Prove the recurrence.");
    expect(r.text).toContain("## Files it links to\n- file_id 1 · L4-master.pdf");
    expect(r.text).not.toContain("bea-secret");
    expect((await run(ctx, "search", { query: "prove recurrence" })).text).toContain(`→ read_item item_id=${id}`);
  });

  it("searches names even before any passages are indexed", async () => {
    const r = await run(ctx, "search", { query: "tut1" });
    expect(r.text).toContain("tut1.txt (file_id 3)");
    expect((await run(other, "search", { query: "tut1" })).text).not.toContain("tut1.txt");
  });
});
