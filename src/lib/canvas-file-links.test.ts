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
