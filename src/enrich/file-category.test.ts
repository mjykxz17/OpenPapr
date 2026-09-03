import { describe, expect, it, vi } from "vitest";
import { createDb } from "../db/client";
import { files, modules, users } from "../db/schema";
import { setFileCategory, upsertModuleFiles } from "../db/repo";
import { categorizeByRule, categorizeModuleFiles, createCompatFileCategorizer, type FileCategorizer } from "./file-category";

const pdf = "application/pdf";
const pptx = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const docx = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const xlsx = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

describe("categorizeByRule", () => {
  // Real filenames from the author's modules. Each row names the category a
  // person would give it at a glance; null means the name alone is not enough.
  const cases: [string, string | null, string | null][] = [
    ["IFS4103-Lect-1-v1-3.pdf", pdf, "slides"],
    ["IFS4103-Lect-1-v1-BW-3.pdf", pdf, "slides"],
    ["CS4238-Lec01A.pptx", pptx, "slides"],
    ["U0-prelim.pdf", pdf, "slides"],
    ["U1-intro1.pdf", pdf, "slides"],
    ["W2->3.pptx", pptx, "slides"],
    ["W10-to-11.pptx", pptx, "slides"],
    ["Burpsuite Walkthrough 1.pdf", pdf, "tutorial"],
    ["gec1044-geh1070 tutorial 1.pdf", pdf, "tutorial"],
    ["T10-DG-Extracts.pdf", pdf, "tutorial"],
    ["T11-Answers.pdf", pdf, "tutorial"],
    ["lab0.zip", "application/x-zip-compressed", "tutorial"],
    ["assignment1-2.pdf", pdf, "assignment"],
    ["SampleQuiz-1.docx", docx, "practice"],
    ["SampleQuiz-1 - Answer.docx", docx, "practice"],
    ["Practice exam - part 1 (answers).pdf", pdf, "practice"],
    ["Mock exam (answers).pdf", pdf, "practice"],
    ["Additional practice questions for part 1.pdf", pdf, "practice"],
    ["exam-reference-sheet-2025-11-03.pdf", pdf, "practice"],
    ["Topic 1_Han (Optional).pdf", pdf, "reading"],
    ["Topic 2_Teo You Yenn (Mandatory).pdf", pdf, "reading"],
    ["Ted Kaptchuk - The Web That Has No Weaver_ (1984) Chapter 1.pdf", pdf, "reading"],
    ["Medicine, Philosophy and Religion in Ancient China pp. 1-11.pdf", pdf, "reading"],
    ["Charles Chase - Song to Qing.pdf", pdf, "reading"],
    ["Daoism and Medicine- Michael Stanley-Baker.pdf", pdf, "reading"],
    ["GES1035_GESS1025 AY24_25 Sem2 Final Quiz Seating Plan.xlsx", xlsx, "admin"],
    ["Course Outline_2025.docx", docx, "admin"],
    ["Medical Hall Product Survey.docx", docx, "admin"],
    ["Background-Survey-Results.pdf", pdf, "admin"],
    ["Feedback for Lecture Topic 5 (Diversity, Social Integration and Urban Environment).pdf", pdf, "admin"],
    ["CSIT_Career_Opportunities_EDM.png", "image/png", "image"],
    ["image002.jpg", "image/jpeg", "image"],
    ["course-page-hacking.jpg", "image/jpeg", "image"],
    ["intro.pdf", pdf, null],
    ["C-part2-pointers.pdf", pdf, null],
    ["Group Fieldwork- A Simple Guide.pdf", pdf, null],
  ];
  for (const [name, type, want] of cases) {
    it(`${name} → ${want ?? "undecided"}`, () => {
      expect(categorizeByRule({ displayName: name, contentType: type })).toBe(want);
    });
  }
});

const cfg = { baseUrl: "https://agrouter.example/v1", apiKey: "sk-test", model: "agnes-2.5-flash" };
const chat = (content: string) =>
  new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
const undecided = [
  { id: 1, displayName: "intro.pdf", contentType: pdf, linkedFrom: "Introduction — please bring your laptops!", linkContext: "Slides for today: intro.pdf" },
  { id: 2, displayName: "Group Fieldwork- A Simple Guide.pdf", contentType: pdf, linkedFrom: null, linkContext: null },
];

describe("createCompatFileCategorizer", () => {
  it("sends the link context along with the name and maps ids to categories in one call", async () => {
    const fetchFn = vi.fn(async () => chat('{"files":[{"id":1,"category":"slides"},{"id":2,"category":"assignment"}]}'));
    const out = await createCompatFileCategorizer(cfg, fetchFn as never)(undecided);
    expect(out).toEqual(new Map([[1, "slides"], [2, "assignment"]]));
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const body = JSON.parse((fetchFn.mock.calls[0] as unknown as [string, { body: string }])[1].body) as { messages: { content: string }[] };
    expect(body.messages.at(-1)!.content).toContain("please bring your laptops");
  });
  it("files the model leaves out as other, so they are not asked about every cycle", async () => {
    const fetchFn = vi.fn(async () => chat('{"files":[{"id":1,"category":"slides"}]}'));
    const out = await createCompatFileCategorizer(cfg, fetchFn as never)(undecided);
    expect(out!.get(2)).toBe("other");
  });
  it("drops ids the model invents", async () => {
    const fetchFn = vi.fn(async () => chat('{"files":[{"id":1,"category":"slides"},{"id":2,"category":"other"},{"id":99,"category":"slides"}]}'));
    const out = await createCompatFileCategorizer(cfg, fetchFn as never)(undecided);
    expect(out!.has(99)).toBe(false);
  });
  it("returns null when the call fails or the reply is not the schema", async () => {
    expect(await createCompatFileCategorizer(cfg, vi.fn(async () => new Response("x", { status: 500 })) as never)(undecided)).toBeNull();
    expect(await createCompatFileCategorizer(cfg, vi.fn(async () => chat('{"files":[{"id":1,"category":"homework"}]}')) as never)(undecided)).toBeNull();
  });
  it("does not call the model for an empty batch", async () => {
    const fetchFn = vi.fn();
    expect(await createCompatFileCategorizer(cfg, fetchFn as never)([])).toEqual(new Map());
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe("categorizeModuleFiles", () => {
  const setup = () => {
    const db = createDb(":memory:");
    db.insert(users).values({ name: "a" }).run();
    db.insert(modules).values({ userId: 1, canvasCourseId: 96697, code: "IFS4103", name: "PenTest" }).run();
    upsertModuleFiles(db, 1, [
      { canvasFileId: 10, displayName: "IFS4103-Lect-1.pdf", contentType: pdf, sizeBytes: 1, hidden: true },
      { canvasFileId: 11, displayName: "intro.pdf", contentType: pdf, sizeBytes: 1, hidden: true, linkedFrom: "Introduction", linkContext: "slides: intro.pdf" },
      { canvasFileId: 12, displayName: "image002.jpg", contentType: "image/jpeg", sizeBytes: 1, hidden: true },
    ], 100);
    return db;
  };
  const byCanvasId = (db: ReturnType<typeof setup>) =>
    Object.fromEntries(db.select().from(files).all().map((r) => [r.canvasFileId, [r.category, r.categorySource]]));

  it("applies rules first and stamps them as rule", async () => {
    const db = setup();
    await categorizeModuleFiles(db, 1, null);
    const got = byCanvasId(db);
    expect(got[10]).toEqual(["slides", "rule"]);
    expect(got[12]).toEqual(["image", "rule"]);
    expect(got[11]).toEqual([null, null]);
  });

  it("sends only what the rules could not decide to the model, with its link context", async () => {
    const db = setup();
    const llm = vi.fn<FileCategorizer>(async (batch) => new Map(batch.map((f) => [f.id, "slides" as const])));
    await categorizeModuleFiles(db, 1, llm);
    expect(llm).toHaveBeenCalledTimes(1);
    const sent = llm.mock.calls[0]![0];
    expect(sent.map((f) => f.displayName)).toEqual(["intro.pdf"]);
    expect(sent[0]!.linkedFrom).toBe("Introduction");
    expect(byCanvasId(db)[11]).toEqual(["slides", "llm"]);
  });

  it("leaves files null when the model fails, so a later cycle retries them", async () => {
    const db = setup();
    await categorizeModuleFiles(db, 1, vi.fn(async () => null));
    expect(byCanvasId(db)[11]).toEqual([null, null]);
  });

  it("does not revisit files that already have a category", async () => {
    const db = setup();
    const id = db.select().from(files).all().find((r) => r.canvasFileId === 11)!.id;
    setFileCategory(db, id, "reading", "manual");
    const llm = vi.fn(async () => new Map());
    await categorizeModuleFiles(db, 1, llm);
    expect(llm).not.toHaveBeenCalled();
    expect(byCanvasId(db)[11]).toEqual(["reading", "manual"]);
  });
});
