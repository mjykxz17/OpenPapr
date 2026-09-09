import { describe, expect, it, vi } from "vitest";
import { createDb } from "../db/client";
import { components, files, modules, users } from "../db/schema";
import { setModuleNotes, setModuleProfile } from "../db/repo";
import { createModuleProfiler, loadModuleContext, sampleDeck } from "./module-context";

const cfg = { baseUrl: "https://agrouter.example/v1", apiKey: "sk-test", model: "agnes-2.5-flash" };
const chat = (content: string) =>
  new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });

describe("sampleDeck", () => {
  it("returns a short deck whole", () => {
    expect(sampleDeck("short deck")).toBe("short deck");
  });

  it("takes the head and a slice from the middle of a long deck", () => {
    const text = "H".repeat(2000) + "M".repeat(2000) + "T".repeat(2000);
    const out = sampleDeck(text, 100, 50);
    expect(out.startsWith("H".repeat(100))).toBe(true);
    expect(out).toContain("[...]\n" + "M".repeat(50) + "\n[...]");
    expect(out).not.toContain("T");
  });
});

describe("createModuleProfiler", () => {
  const mod = { code: "IFS4103", name: "PenTest" };
  const decks = [{ name: "Lect-1", text: "-- 1 of 2 --\nRecon\n-- 2 of 2 --\nnmap -sV" }];

  it("sends the module and sampled decks and returns the model's markdown", async () => {
    const fetchFn = vi.fn(async () => chat("### What the module is about\nRecon with nmap."));
    const profile = await createModuleProfiler(cfg, fetchFn as never)(mod, decks);
    expect(profile).toBe("### What the module is about\nRecon with nmap.");
    const [, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.messages[1].content).toContain("Module: IFS4103 PenTest");
    expect(body.messages[1].content).toContain("=== Lect-1 ===");
    expect(body.messages[1].content).toContain("nmap -sV");
  });

  it("stops adding decks once the character budget is spent, but still profiles", async () => {
    const fetchFn = vi.fn(async () => chat("### What the module is about\nx"));
    const many = Array.from({ length: 5 }, (_, i) => ({ name: `L${i}`, text: "x".repeat(1000) }));
    await createModuleProfiler(cfg, fetchFn as never, 2500)(mod, many);
    const [, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    const content = JSON.parse(init.body as string).messages[1].content as string;
    expect(content).toContain("Decks sampled: 2 of 5");
    expect(content).not.toContain("=== L2 ===");
  });

  it("fails open on HTTP errors", async () => {
    const fetchFn = vi.fn(async () => new Response("overloaded", { status: 529 }));
    expect(await createModuleProfiler(cfg, fetchFn as never)(mod, decks)).toBeNull();
  });

  it("rejects a reply that is not the requested markdown", async () => {
    const fetchFn = vi.fn(async () => chat("Sure! Here is a profile..."));
    expect(await createModuleProfiler(cfg, fetchFn as never)(mod, decks)).toBeNull();
  });

  it("does nothing with no decks", async () => {
    const fetchFn = vi.fn();
    expect(await createModuleProfiler(cfg, fetchFn as never)(mod, [])).toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe("loadModuleContext", () => {
  const setup = () => {
    const db = createDb(":memory:");
    db.insert(users).values({ name: "a" }).run();
    db.insert(modules).values({ userId: 1, canvasCourseId: 96697, code: "IFS4103", name: "IFS4103 Penetration Testing Practice [2610]", term: "2026/2027 Semester 1" }).run();
    db.insert(components).values([
      { moduleId: 1, name: "Practical", weightPct: 60, source: "llm_syllabus" },
      { moduleId: 1, name: "Final", weightPct: 40, source: "canvas_api" },
      { moduleId: 1, name: "Participation", weightPct: 5, source: "canvas_api" },
      { moduleId: 1, name: "Participation", weightPct: 10, source: "manual" },
    ]).run();
    db.insert(files).values([
      { moduleId: 1, canvasFileId: 1, displayName: "IFS4103-Lect-2-v1.pdf", category: "slides", discoveredAt: 1 },
      { moduleId: 1, canvasFileId: 2, displayName: "IFS4103-Lect-1-v1.pdf", category: "slides", discoveredAt: 1 },
      { moduleId: 1, canvasFileId: 3, displayName: "IFS4103-Lect-1-v1-BW.pdf", category: "slides", discoveredAt: 1 },
      { moduleId: 1, canvasFileId: 4, displayName: "assignment1.pdf", category: "assignment", discoveredAt: 1 },
    ]).run();
    return db;
  };

  it("is null for a module that does not exist", () => {
    expect(loadModuleContext(setup(), 99)).toBeNull();
  });

  it("assembles facts from the database: title, assessment, decks in order without printable twins", () => {
    const ctx = loadModuleContext(setup(), 1)!;
    expect(ctx.input.decks).toEqual(["IFS4103-Lect-1-v1", "IFS4103-Lect-2-v1"]);
    expect(ctx.context).toContain("# IFS4103 Penetration Testing Practice");
    expect(ctx.context).toContain("- Practical: 60%");
    // The manual weight shadows the Canvas one; the prompt gets one answer.
    expect(ctx.context).toContain("- Participation: 10% (entered by the student)");
    expect(ctx.context).not.toContain("Participation: 5%");
    expect(ctx.context).toContain("1. IFS4103-Lect-1-v1\n2. IFS4103-Lect-2-v1");
    expect(ctx.profiledAt).toBeNull();
    expect(ctx.notesUpdatedAt).toBeNull();
  });

  it("folds in the stored profile and notes", () => {
    const db = setup();
    setModuleProfile(db, 1, "### How the lecturer teaches\nDemos first.", "2 decks, m", 10);
    setModuleNotes(db, 1, 1, "Exam is open book.", 20);
    const ctx = loadModuleContext(db, 1)!;
    expect(ctx.context).toContain("as observed from the decks\n### How the lecturer teaches\nDemos first.");
    expect(ctx.context).toContain("## Notes from the student\nExam is open book.");
    expect(ctx.profiledAt).toBe(10);
    expect(ctx.profileSource).toBe("2 decks, m");
    expect(ctx.notesUpdatedAt).toBe(20);
  });
});
