import { describe, expect, it } from "vitest";
import { outlineFileLinks, outlineFrom, outlinePages } from "./course-outline";

describe("course outline", () => {
  const outline = outlineFrom([
    { id: 2, name: "Week 2", position: 2, items: [{ id: 9, title: "Zoom", type: "ExternalTool", position: 1, external_url: "https://zoom.example/j/1" }] },
    { id: 1, name: "Week 1", position: 1, unlock_at: "2026-08-11T00:00:00Z", items: [
      { id: 5, title: "Slides", type: "File", position: 2, content_id: 501, indent: 1 },
      { id: 4, title: "Intro", type: "Page", position: 1, page_url: "intro" },
      { id: 6, title: "Hidden", type: "Page", position: 3, page_url: "later", content_details: { locked_for_user: true } },
      { id: 7, title: "Lab 1", type: "Assignment", position: 4, content_id: 88 },
      { id: 8, title: "Something new", type: "Unknown", position: 5 },
    ] },
  ]);

  it("keeps the lecturer's order and what each item points at", () => {
    expect(outline.map((w) => w.name)).toEqual(["Week 1", "Week 2"]);
    expect(outline[0]!.unlockAt).toBe(Date.parse("2026-08-11T00:00:00Z"));
    expect(outline[0]!.items).toEqual([
      { kind: "page", title: "Intro", indent: 0, pageUrl: "intro" },
      { kind: "file", title: "Slides", indent: 1, canvasFileId: 501 },
      { kind: "page", title: "Hidden", indent: 0, pageUrl: "later", locked: true },
      { kind: "assignment", title: "Lab 1", indent: 0, contentId: 88 },
    ]);
    expect(outline[1]!.items[0]).toMatchObject({ kind: "tool", url: "https://zoom.example/j/1" });
  });

  it("gives the harvester the open pages and the files, labelled by week", () => {
    expect(outlinePages(outline)).toEqual([{ url: "intro", title: "Intro" }]);
    expect(outlineFileLinks(outline)[0]).toEqual({ label: "Modules: Week 1", html: '<p><a href="/files/501">Slides</a></p>' });
    expect(outlineFileLinks(outline)[1]!.html).toBeNull();
  });
});
