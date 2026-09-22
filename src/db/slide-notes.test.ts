import { describe, expect, it } from "vitest";
import { createDb } from "./client";
import { modules, users } from "./schema";
import { getSlideNote, listSlideNotes, upsertSlideNote } from "./repo";

function seed() {
  const db = createDb(":memory:");
  db.insert(users).values({ name: "a" }).run(); // user 1
  db.insert(modules).values({ id: 7, userId: 1, canvasCourseId: 70, code: "CS4238", name: "CS4238 Computer Security Practice" }).run();
  return db;
}

describe("slide notes", () => {
  it("upserts in place and lists per module", () => {
    const db = seed();
    upsertSlideNote(db, 1, 7, "U3-memdef", 37, "first", 100);
    upsertSlideNote(db, 1, 7, "U3-memdef", 37, "second", 200);
    upsertSlideNote(db, 1, 7, "U3-memdef", 36, "canary", 150);
    expect(getSlideNote(db, 1, 7, "U3-memdef", 37)?.markdown).toBe("second");
    expect(listSlideNotes(db, 1, 7).map((n) => n.page)).toEqual([36, 37]);
  });
  it("deletes on empty text", () => {
    const db = seed();
    upsertSlideNote(db, 1, 7, "U3-memdef", 37, "x", 100);
    upsertSlideNote(db, 1, 7, "U3-memdef", 37, "   \n", 200);
    expect(getSlideNote(db, 1, 7, "U3-memdef", 37)).toBeUndefined();
  });
});
