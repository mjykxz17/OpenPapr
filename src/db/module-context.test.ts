import { describe, expect, it } from "vitest";
import { createDb } from "./client";
import { modules, users } from "./schema";
import { getModuleContext, setModuleNotes, setModuleProfile } from "./repo";

const setup = () => {
  const db = createDb(":memory:");
  db.insert(users).values([{ name: "a" }, { name: "b" }]).run();
  db.insert(modules).values({ userId: 1, canvasCourseId: 96697, code: "IFS4103", name: "PenTest" }).run();
  return db;
};

describe("module context", () => {
  it("starts empty", () => {
    expect(getModuleContext(setup(), 1)).toBeUndefined();
  });

  it("stores the student's notes for a module they own", () => {
    const db = setup();
    expect(setModuleNotes(db, 1, 1, "## Exam\nOpen book.", 100)).toBe(true);
    const row = getModuleContext(db, 1)!;
    expect(row.notes).toBe("## Exam\nOpen book.");
    expect(row.notesUpdatedAt).toBe(100);
  });

  it("refuses to write notes on someone else's module, or a missing one", () => {
    const db = setup();
    expect(setModuleNotes(db, 2, 1, "x", 100)).toBe(false);
    expect(setModuleNotes(db, 1, 99, "x", 100)).toBe(false);
    expect(getModuleContext(db, 1)).toBeUndefined();
  });

  it("replaces notes in place and clears them on blank input", () => {
    const db = setup();
    setModuleNotes(db, 1, 1, "first", 100);
    setModuleNotes(db, 1, 1, "second", 200);
    expect(getModuleContext(db, 1)!.notes).toBe("second");
    setModuleNotes(db, 1, 1, "   ", 300);
    expect(getModuleContext(db, 1)!.notes).toBeNull();
  });

  it("keeps the model's profile and the student's notes independent", () => {
    const db = setup();
    setModuleNotes(db, 1, 1, "mine", 100);
    setModuleProfile(db, 1, "observed", "2 decks, model-x", 200);
    let row = getModuleContext(db, 1)!;
    expect(row.notes).toBe("mine");
    expect(row.profile).toBe("observed");
    expect(row.profileSource).toBe("2 decks, model-x");
    expect(row.profiledAt).toBe(200);

    setModuleNotes(db, 1, 1, "edited", 300);
    row = getModuleContext(db, 1)!;
    expect(row.profile).toBe("observed");
    expect(row.notes).toBe("edited");

    setModuleProfile(db, 1, "re-observed", "3 decks, model-x", 400);
    row = getModuleContext(db, 1)!;
    expect(row.notes).toBe("edited");
    expect(row.profile).toBe("re-observed");
  });
});
