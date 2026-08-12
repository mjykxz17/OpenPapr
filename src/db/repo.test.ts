import { describe, expect, it } from "vitest";
import { createDb } from "./client";
import { items, components, users } from "./schema";
import { applyCanvasSync } from "./repo";
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
