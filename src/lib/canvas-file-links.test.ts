import { describe, expect, it } from "vitest";
import { extractCanvasFileIds } from "./canvas-file-links";

describe("extractCanvasFileIds", () => {
  it("finds a plain course file link", () => {
    expect(extractCanvasFileIds('<a href="/courses/96697/files/2099991">Lecture 1</a>')).toEqual([2099991]);
  });

  it("finds a fully qualified download link", () => {
    const html = '<a href="https://canvas.nus.edu.sg/courses/96697/files/2099991/download?wrap=1">deck</a>';
    expect(extractCanvasFileIds(html)).toEqual([2099991]);
  });

  it("finds the API endpoint Canvas stamps on file links", () => {
    const html = '<a data-api-endpoint="https://canvas.nus.edu.sg/api/v1/courses/96697/files/2099991">x</a>';
    expect(extractCanvasFileIds(html)).toEqual([2099991]);
  });

  it("finds user-scoped file links with no course segment", () => {
    expect(extractCanvasFileIds('<img src="/files/31337/preview">')).toEqual([31337]);
  });

  it("returns each id once, in the order first seen", () => {
    const html = `
      <a href="/courses/1/files/300">a</a>
      <a href="/courses/1/files/100/download">b</a>
      <a href="/courses/1/files/300/download?wrap=1">a again</a>`;
    expect(extractCanvasFileIds(html)).toEqual([300, 100]);
  });

  it("ignores null, empty and file-less html", () => {
    expect(extractCanvasFileIds(null)).toEqual([]);
    expect(extractCanvasFileIds("")).toEqual([]);
    expect(extractCanvasFileIds("<p>No attachments this week.</p>")).toEqual([]);
  });

  // "/files/" appears in plenty of unrelated URLs; only digit segments are ids.
  it("does not treat a non-numeric segment as an id", () => {
    expect(extractCanvasFileIds('<a href="/courses/1/files/folder/Slides">folder</a>')).toEqual([]);
  });

  it("reads several sources at once", () => {
    const a = '<a href="/courses/1/files/10">one</a>';
    const b = '<a href="/courses/1/files/20">two</a>';
    expect(extractCanvasFileIds([a, null, b])).toEqual([10, 20]);
  });
});

import { extractCanvasFileLinks } from "./canvas-file-links";

describe("extractCanvasFileLinks", () => {
  const announcement = {
    label: "Week 2 slides",
    html: '<p>Hi all,</p><p>The deck for Thursday is here: <a href="/courses/96697/files/501/download?wrap=1">IFS4103-Lect-2.pdf</a>. Bring laptops.</p>',
  };

  it("records which source linked the file and the text around the link", () => {
    const [link] = extractCanvasFileLinks([announcement]);
    expect(link).toMatchObject({ id: 501, linkedFrom: "Week 2 slides" });
    expect(link!.context).toContain("The deck for Thursday is here: IFS4103-Lect-2.pdf. Bring laptops.");
  });

  it("flattens the context to one trimmed line of at most 200 characters", () => {
    const long = "word ".repeat(120);
    const html = `<p>${long}</p><p>see <a href="/files/7">this</a></p><p>${long}</p>`;
    const [link] = extractCanvasFileLinks([{ label: "Long post", html }]);
    expect(link!.context).not.toMatch(/\n/);
    expect(link!.context.length).toBeLessThanOrEqual(200);
    expect(link!.context).toContain("see this");
  });

  it("keeps the first source that mentions a file", () => {
    const links = extractCanvasFileLinks([
      { label: "Syllabus", html: '<a href="/courses/1/files/9">outline</a>' },
      { label: "Reminder", html: '<a href="/courses/1/files/9/download">outline again</a> and <a href="/courses/1/files/10">new</a>' },
    ]);
    expect(links.map((l) => [l.id, l.linkedFrom])).toEqual([[9, "Syllabus"], [10, "Reminder"]]);
  });

  it("skips null html and non-numeric segments", () => {
    expect(extractCanvasFileLinks([{ label: "x", html: null }, { label: "y", html: '<a href="/files/folder/a">f</a>' }])).toEqual([]);
  });
});
