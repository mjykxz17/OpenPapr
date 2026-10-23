import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDb } from "../db/client";
import { guideProgress, guideTopics, modules, studyGuides, users } from "../db/schema";
import { chapterKeys, markChapter, readProgress } from "./guide-progress";
import { wipeUserData } from "./account-data";

const guide = (titles: string[]) => `# G\n\n${titles.map((t, i) => `## ${i + 1}. ${t}\n\nText about ${t}.`).join("\n\n")}`;

describe("chapter progress", () => {
  let db: ReturnType<typeof createDb>;
  beforeEach(() => {
    db = createDb(":memory:");
    db.insert(users).values([{ name: "a" }, { name: "b" }]).run();
    db.insert(modules).values({ userId: 1, canvasCourseId: 1, code: "CS4238", name: "Sec" }).run();
    db.insert(studyGuides).values({ moduleId: 1, markdown: guide(["Asymptotics", "Sorting", "Graphs"]), generatedAt: 1 }).run();
  });

  it("marks chapters read and unread, one flag per chapter", () => {
    expect(readProgress(db, 1, 1)).toEqual({ read: [false, false, false] });
    markChapter(db, 1, 1, 0, true, 10);
    expect(markChapter(db, 1, 1, 2, true, 20)).toEqual({ read: [true, false, true] });
    expect(markChapter(db, 1, 1, 0, false, 30)).toEqual({ read: [false, false, true] });
    expect(markChapter(db, 1, 1, 7, true, 30)).toMatchObject({ status: 404 });
  });

  it("is the student's own", () => {
    expect(readProgress(db, 2, 1)).toMatchObject({ status: 404 });
    expect(markChapter(db, 2, 1, 0, true, 10)).toMatchObject({ status: 404 });
  });

  it("follows a chapter by its topic key when the guide is renumbered", () => {
    db.insert(guideTopics).values([
      { moduleId: 1, key: "asym", title: "Asymptotics", ord: 0, inputHash: "x" },
      { moduleId: 1, key: "sort", title: "Sorting", ord: 1, inputHash: "x" },
    ]).run();
    expect(chapterKeys(db, 1, guide(["Asymptotics", "Sorting", "Graphs"]))).toEqual(["asym", "sort", "h:graphs"]);
    markChapter(db, 1, 1, 1, true, 10);
    // A new chapter lands in front: "Sorting" is now chapter 3 and still read.
    db.update(studyGuides).set({ markdown: guide(["Intro", "Asymptotics", "Sorting", "Graphs"]) }).where(eq(studyGuides.moduleId, 1)).run();
    expect(readProgress(db, 1, 1)).toEqual({ read: [false, false, true, false] });
  });

  it("is cleared with the rest of the student's data", () => {
    markChapter(db, 1, 1, 0, true, 10);
    wipeUserData(db, 1);
    expect(db.select().from(guideProgress).all()).toEqual([]);
  });
});
