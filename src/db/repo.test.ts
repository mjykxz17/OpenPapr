import { describe, expect, it } from "vitest";
import { createDb } from "./client";
import { items, components, users, modules, studyGuides } from "./schema";
import { applyCanvasSync, applyExtractedActions, setModuleActivity, shouldAttemptWeightage, upsertStudyGuide, getStudyGuide, listStudyGuides, setModuleOrder } from "./repo";
import { eq } from "drizzle-orm";
import type { NormalizedCanvasSync } from "../connectors/canvas/normalize";

const base: NormalizedCanvasSync = {
  module: { canvasCourseId: 7, code: "CS2103T", name: "SE", term: null, syllabusBody: null },
  components: [{ name: "tP", weightPct: 45, scorePct: null, source: "canvas_api" }],
  items: [{ type: "assignment", sourceId: "assignment:11", title: "tP v1.3", body: null, url: null, dueAt: 1000, sourceCreatedAt: null, submitted: false }],
};
const setup = () => {
  const db = createDb(":memory:");
  db.insert(users).values({ name: "a" }).run();
  return db;
};

describe("applyCanvasSync", () => {
  it("is idempotent — re-applying changes nothing", () => {
    const db = setup();
    applyCanvasSync(db, 1, base, 1);
    applyCanvasSync(db, 1, base, 2);
    expect(db.select().from(items).all()).toHaveLength(1);
    expect(db.select().from(components).all()).toHaveLength(1);
  });
  it("emits a deadline_change item when dueAt moves", () => {
    const db = setup();
    applyCanvasSync(db, 1, base, 1);
    const moved = { ...base, items: [{ ...base.items[0], dueAt: 2000 }] };
    applyCanvasSync(db, 1, moved, 5);
    const all = db.select().from(items).all();
    expect(all).toHaveLength(2);
    const change = all.find((i) => i.type === "deadline_change")!;
    expect(change.sourceId).toBe("assignment:11:due:2000");
    expect(all.find((i) => i.type === "assignment")!.dueAt).toBe(2000);
  });
  it("never overwrites manual components", () => {
    const db = setup();
    const { moduleId } = applyCanvasSync(db, 1, base, 1);
    db.insert(components).values({ moduleId, name: "tP", weightPct: 50, source: "manual" }).run();
    applyCanvasSync(db, 1, base, 2);
    const manual = db.select().from(components).where(eq(components.source, "manual")).all();
    expect(manual[0].weightPct).toBe(50);
  });
});

describe("setModuleActivity", () => {
  const mod = (canvasCourseId: number, code: string, term: string | null) => ({
    userId: 1, canvasCourseId, code, name: code, term,
  });
  it("keeps only the newest term active; Non-Academic and old terms deactivate", () => {
    const db = setup();
    db.insert(modules).values([
      mod(1, "CS4238", "[2610] 2026/2027 Semester 1"),
      mod(2, "CS2103", "[2510] 2025/2026 Semester 1"),
      mod(3, "GES1035", "[2420] 2024/2025 Semester 2"),
      mod(4, "RC1010A", "Non-Academic"),
      mod(5, "THE1001", null),
    ]).run();
    setModuleActivity(db, 1);
    const active = db.select().from(modules).all().filter((m) => m.active).map((m) => m.code);
    expect(active).toEqual(["CS4238"]);
  });
  it("is idempotent and re-activates a module whose term becomes current", () => {
    const db = setup();
    db.insert(modules).values([mod(1, "CS4238", "[2610] x"), mod(2, "OLD1", "[2510] x")]).run();
    setModuleActivity(db, 1);
    setModuleActivity(db, 1);
    expect(db.select().from(modules).all().find((m) => m.code === "CS4238")!.active).toBe(true);
    expect(db.select().from(modules).all().find((m) => m.code === "OLD1")!.active).toBe(false);
  });
  it("leaves everything active when no module has a numeric term", () => {
    const db = setup();
    db.insert(modules).values([mod(1, "A", "Non-Academic"), mod(2, "B", null)]).run();
    setModuleActivity(db, 1);
    expect(db.select().from(modules).all().every((m) => m.active)).toBe(true);
  });
});

describe("applyExtractedActions", () => {
  const seedParent = (db: ReturnType<typeof setup>) => {
    const { moduleId } = applyCanvasSync(db, 1, base, 1);
    return db.insert(items).values({
      userId: 1, moduleId, source: "canvas", type: "announcement", sourceId: "announcement:9",
      title: "Quiz details", body: "Quiz on Thursday", firstSeenAt: 1,
    }).returning().get();
  };
  const action = { title: "In-person quiz", dueAt: 5_000_000, evidence: "Quiz on Thursday 6:30pm" };
  it("inserts deadline items inheriting the parent's module and marks the parent processed", () => {
    const db = setup();
    const parent = seedParent(db);
    applyExtractedActions(db, 1, parent.id, [action], 99);
    const all = db.select().from(items).all();
    const dl = all.find((i) => i.type === "deadline")!;
    expect(dl.moduleId).toBe(parent.moduleId);
    expect(dl.dueAt).toBe(5_000_000);
    expect(dl.body).toBe("Quiz on Thursday 6:30pm");
    expect(dl.sourceId.startsWith("announcement:9:action:")).toBe(true);
    expect(all.find((i) => i.id === parent.id)!.actionsExtractedAt).toBe(99);
  });
  it("is idempotent on re-apply", () => {
    const db = setup();
    const parent = seedParent(db);
    applyExtractedActions(db, 1, parent.id, [action], 99);
    applyExtractedActions(db, 1, parent.id, [action], 100);
    expect(db.select().from(items).all().filter((i) => i.type === "deadline")).toHaveLength(1);
  });
  it("skips actions duplicating an existing same-module item due within 48h", () => {
    const db = setup();
    const parent = seedParent(db);
    // base sync already inserted assignment "tP v1.3" dueAt 1000 — add a quiz assignment near the action's time
    db.insert(items).values({
      userId: 1, moduleId: parent.moduleId, source: "canvas", type: "assignment",
      sourceId: "assignment:77", title: "Quiz 4", dueAt: 5_000_000 + 3_600_000, firstSeenAt: 1,
    }).run();
    applyExtractedActions(db, 1, parent.id, [action], 99);
    expect(db.select().from(items).all().filter((i) => i.type === "deadline")).toHaveLength(0);
    expect(db.select().from(items).all().find((i) => i.id === parent.id)!.actionsExtractedAt).toBe(99);
  });
});

describe("applyExtractedActions cross-parent dedupe", () => {
  it("skips an action already extracted from a different announcement", () => {
    const db = setup();
    const { moduleId } = applyCanvasSync(db, 1, base, 1);
    const mk = (sourceId: string) => db.insert(items).values({
      userId: 1, moduleId, source: "canvas", type: "announcement", sourceId, title: "t", body: "b", firstSeenAt: 1,
    }).returning().get();
    const p1 = mk("announcement:1");
    const p2 = mk("announcement:2");
    const action = { title: "Bring PC to class", dueAt: 9_000_000, evidence: "bring your PC" };
    applyExtractedActions(db, 1, p1.id, [action], 50);
    applyExtractedActions(db, 1, p2.id, [action], 60);
    expect(db.select().from(items).all().filter((i) => i.type === "deadline")).toHaveLength(1);
  });
});

describe("shouldAttemptWeightage", () => {
  const WEEK = 7 * 24 * 3_600_000;
  it("attempts when no components and never checked", () => {
    expect(shouldAttemptWeightage(0, null, 1000)).toBe(true);
  });
  it("skips when components exist", () => {
    expect(shouldAttemptWeightage(3, null, 1000)).toBe(false);
  });
  it("skips within a week of the last attempt, retries after", () => {
    expect(shouldAttemptWeightage(0, 1000, 1000 + WEEK - 1)).toBe(false);
    expect(shouldAttemptWeightage(0, 1000, 1000 + WEEK + 1)).toBe(true);
  });
});

describe("study guides", () => {
  const seed = () => {
    const db = setup();
    db.insert(modules).values({ userId: 1, canvasCourseId: 7, code: "CS4239", name: "Software Security" }).run();
    db.insert(modules).values({ userId: 1, canvasCourseId: 8, code: "CS4238", name: "Computer Security" }).run();
    return db;
  };
  it("upserts a guide and reads it back by module", () => {
    const db = seed();
    upsertStudyGuide(db, 1, "# Guide\ncontent", "8 decks", 1000);
    const g = getStudyGuide(db, 1);
    expect(g?.markdown).toBe("# Guide\ncontent");
    expect(g?.sourceNote).toBe("8 decks");
    expect(g?.generatedAt).toBe(1000);
  });
  it("replaces rather than duplicates on re-import", () => {
    const db = seed();
    upsertStudyGuide(db, 1, "old", null, 1000);
    upsertStudyGuide(db, 1, "new", "note", 2000);
    expect(getStudyGuide(db, 1)?.markdown).toBe("new");
    expect(db.select().from(studyGuides).all()).toHaveLength(1);
  });
  it("returns undefined when a module has no guide", () => {
    expect(getStudyGuide(seed(), 2)).toBeUndefined();
  });
  it("lists guides for a user with module code and name, newest first", () => {
    const db = seed();
    upsertStudyGuide(db, 1, "a", "8 decks", 1000);
    upsertStudyGuide(db, 2, "b", "3 decks", 3000);
    const list = listStudyGuides(db, 1);
    expect(list.map((g) => g.code)).toEqual(["CS4238", "CS4239"]);
    expect(list[0]).toMatchObject({ moduleId: 2, code: "CS4238", name: "Computer Security", sourceNote: "3 decks" });
  });
});

describe("setModuleOrder", () => {
  const seed = () => {
    const db = setup();
    db.insert(users).values({ name: "b" }).run(); // user 2
    db.insert(modules).values({ userId: 1, canvasCourseId: 10, code: "A", name: "A" }).run();
    db.insert(modules).values({ userId: 1, canvasCourseId: 11, code: "B", name: "B" }).run();
    db.insert(modules).values({ userId: 1, canvasCourseId: 12, code: "C", name: "C" }).run();
    db.insert(modules).values({ userId: 2, canvasCourseId: 13, code: "X", name: "X" }).run(); // other user
    return db;
  };
  it("assigns positions in the given order", () => {
    const db = seed();
    setModuleOrder(db, 1, [3, 1, 2]);
    const pos = (id: number) => db.select().from(modules).where(eq(modules.id, id)).get()!.position;
    expect(pos(3)).toBe(0);
    expect(pos(1)).toBe(1);
    expect(pos(2)).toBe(2);
  });
  it("does not touch modules owned by another user", () => {
    const db = seed();
    setModuleOrder(db, 1, [4, 1]); // id 4 belongs to user 2
    expect(db.select().from(modules).where(eq(modules.id, 4)).get()!.position).toBeNull();
    expect(db.select().from(modules).where(eq(modules.id, 1)).get()!.position).toBe(1);
  });
});
