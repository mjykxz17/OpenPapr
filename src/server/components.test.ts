import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createDb } from "../db/client";
import { components, modules, users } from "../db/schema";
import { upsertManualComponent } from "./components";

const setup = () => {
  const db = createDb(":memory:");
  db.insert(users).values([{ name: "a" }, { name: "b" }]).run();
  const mod1 = db.insert(modules).values({ userId: 1, canvasCourseId: 7, code: "CS2103T", name: "SE" }).returning().get();
  const mod2 = db.insert(modules).values({ userId: 2, canvasCourseId: 8, code: "CS2100", name: "CO" }).returning().get();
  return { db, mod1Id: mod1.id, mod2Id: mod2.id };
};

describe("upsertManualComponent", () => {
  it("upserts a manual component for a module the user owns", () => {
    const { db, mod1Id } = setup();
    const ok = upsertManualComponent(db, 1, { moduleId: mod1Id, name: "tP", weightPct: 50, scorePct: null });
    expect(ok).toBe(true);
    const rows = db.select().from(components).where(eq(components.moduleId, mod1Id)).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].source).toBe("manual");
    expect(rows[0].weightPct).toBe(50);
  });

  it("rejects a module owned by a different user (IDOR guard)", () => {
    const { db, mod2Id } = setup();
    const ok = upsertManualComponent(db, 1, { moduleId: mod2Id, name: "tP", weightPct: 50, scorePct: null });
    expect(ok).toBe(false);
    const rows = db.select().from(components).where(eq(components.moduleId, mod2Id)).all();
    expect(rows).toHaveLength(0);
  });

  it("returns false for a nonexistent module", () => {
    const { db } = setup();
    const ok = upsertManualComponent(db, 1, { moduleId: 9999, name: "tP", weightPct: 50, scorePct: null });
    expect(ok).toBe(false);
  });

  it("updates the existing manual row on re-post instead of duplicating it", () => {
    const { db, mod1Id } = setup();
    upsertManualComponent(db, 1, { moduleId: mod1Id, name: "tP", weightPct: 50, scorePct: null });
    const ok = upsertManualComponent(db, 1, { moduleId: mod1Id, name: "tP", weightPct: 60, scorePct: 80 });
    expect(ok).toBe(true);
    const rows = db.select().from(components).where(eq(components.moduleId, mod1Id)).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].weightPct).toBe(60);
    expect(rows[0].scorePct).toBe(80);
  });
});
