import { describe, expect, it } from "vitest";
import { createDb } from "./client";
import { files, modules, users } from "./schema";
import { findModuleFileByStem, upsertModuleFiles } from "./repo";

const setup = () => {
  const db = createDb(":memory:");
  db.insert(users).values({ name: "a" }).run();
  db.insert(modules).values({ userId: 1, canvasCourseId: 96697, code: "IFS4103", name: "PenTest" }).run();
  return db;
};

const f = (id: number, name: string, hidden = false) => ({
  canvasFileId: id, displayName: name, contentType: "application/pdf", sizeBytes: 1000, hidden,
});

describe("upsertModuleFiles", () => {
  it("records files for a module", () => {
    const db = setup();
    upsertModuleFiles(db, 1, [f(1, "Lect-1.pdf"), f(2, "Lect-2.pdf")], 100);
    expect(db.select().from(files).all()).toHaveLength(2);
  });

  it("is idempotent — re-syncing does not duplicate", () => {
    const db = setup();
    upsertModuleFiles(db, 1, [f(1, "Lect-1.pdf")], 100);
    upsertModuleFiles(db, 1, [f(1, "Lect-1.pdf")], 200);
    expect(db.select().from(files).all()).toHaveLength(1);
  });

  it("updates a renamed file rather than adding a second row", () => {
    const db = setup();
    upsertModuleFiles(db, 1, [f(1, "old.pdf")], 100);
    upsertModuleFiles(db, 1, [f(1, "new.pdf")], 200);
    const rows = db.select().from(files).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.displayName).toBe("new.pdf");
  });

  // A file first seen in the Files listing and later found linked in HTML (or
  // the reverse) is one file; the visible listing is the more trustworthy
  // source, so a listed file must not be demoted to hidden.
  it("keeps a file visible once the listing has shown it", () => {
    const db = setup();
    upsertModuleFiles(db, 1, [f(1, "deck.pdf", false)], 100);
    upsertModuleFiles(db, 1, [f(1, "deck.pdf", true)], 200);
    expect(db.select().from(files).all()[0]!.hidden).toBe(false);
  });

  it("promotes a hidden file to visible when the listing later shows it", () => {
    const db = setup();
    upsertModuleFiles(db, 1, [f(1, "deck.pdf", true)], 100);
    upsertModuleFiles(db, 1, [f(1, "deck.pdf", false)], 200);
    expect(db.select().from(files).all()[0]!.hidden).toBe(false);
  });
});

describe("findModuleFileByStem", () => {
  it("matches on the filename stem, ignoring extension and case", () => {
    const db = setup();
    upsertModuleFiles(db, 1, [f(7, "IFS4103-Lect-1-v1-3.pdf")], 100);
    expect(findModuleFileByStem(db, 1, "ifs4103-lect-1-v1-3")?.canvasFileId).toBe(7);
    expect(findModuleFileByStem(db, 1, "IFS4103-Lect-1-v1-3.pdf")?.canvasFileId).toBe(7);
  });

  it("returns undefined when nothing matches", () => {
    const db = setup();
    upsertModuleFiles(db, 1, [f(7, "Lect-1.pdf")], 100);
    expect(findModuleFileByStem(db, 1, "Lect-9")).toBeUndefined();
  });

  it("prefers a visible file over a hidden one with the same stem", () => {
    const db = setup();
    upsertModuleFiles(db, 1, [f(1, "deck.pdf", true), f(2, "deck.pdf", false)], 100);
    expect(findModuleFileByStem(db, 1, "deck")?.canvasFileId).toBe(2);
  });

  it("does not reach across modules", () => {
    const db = setup();
    db.insert(modules).values({ userId: 1, canvasCourseId: 999, code: "OTHER", name: "Other" }).run();
    upsertModuleFiles(db, 2, [f(7, "Lect-1.pdf")], 100);
    expect(findModuleFileByStem(db, 1, "Lect-1")).toBeUndefined();
  });
});

import { listModuleFiles, setFileCategory } from "./repo";

describe("file categories and link context", () => {
  it("stores where a harvested file was linked from and the text around the link", () => {
    const db = setup();
    upsertModuleFiles(db, 1, [{ ...f(5, "intro.pdf", true), linkedFrom: "Introduction — bring laptops", linkContext: "slides for today: intro.pdf" }], 100);
    const row = db.select().from(files).get()!;
    expect(row.linkedFrom).toBe("Introduction — bring laptops");
    expect(row.linkContext).toBe("slides for today: intro.pdf");
  });

  it("re-syncing a file keeps the category already assigned to it", () => {
    const db = setup();
    upsertModuleFiles(db, 1, [f(5, "intro.pdf", true)], 100);
    const id = db.select().from(files).get()!.id;
    setFileCategory(db, id, "slides", "llm");
    upsertModuleFiles(db, 1, [f(5, "intro.pdf", true)], 200);
    expect(db.select().from(files).get()!.category).toBe("slides");
  });

  it("never lets a rule or model overwrite a manual category", () => {
    const db = setup();
    upsertModuleFiles(db, 1, [f(5, "intro.pdf")], 100);
    const id = db.select().from(files).get()!.id;
    setFileCategory(db, id, "reading", "manual");
    setFileCategory(db, id, "slides", "rule");
    setFileCategory(db, id, "slides", "llm");
    const row = db.select().from(files).get()!;
    expect([row.category, row.categorySource]).toEqual(["reading", "manual"]);
  });

  it("lists a module's files by name", () => {
    const db = setup();
    upsertModuleFiles(db, 1, [f(2, "Lect-2.pdf"), f(1, "Lect-1.pdf")], 100);
    expect(listModuleFiles(db, 1).map((r) => r.displayName)).toEqual(["Lect-1.pdf", "Lect-2.pdf"]);
  });
});
