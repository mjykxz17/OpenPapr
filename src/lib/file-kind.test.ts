import { describe, expect, it } from "vitest";
import { fileExt, fileKind, servedType } from "./file-kind";

describe("fileKind", () => {
  it.each([
    ["L01 Intro.PDF", "pdf"], ["week3.pptx", "office"], ["notes.docx", "office"], ["marks.xlsx", "office"],
    ["photo.JPG", "image"], ["lecture.mp4", "video"], ["podcast.mp3", "audio"], ["data.csv", "text"],
    ["main.py", "text"], ["lab.zip", "none"], ["page.html", "none"], ["logo.svg", "none"], ["README", "none"],
  ])("%s → %s", (name, kind) => expect(fileKind(name)).toBe(kind));
});

describe("servedType", () => {
  it("never serves markup as a document", () => {
    expect(servedType("x.html")).toBe("application/octet-stream");
    expect(servedType("x.svg")).toBe("application/octet-stream");
    expect(servedType("x.xml")).toBe("text/plain; charset=utf-8");
  });
  it("gives media their real types", () => {
    expect(servedType("a.jpg")).toBe("image/jpeg");
    expect(servedType("a.mp3")).toBe("audio/mpeg");
    expect(servedType("a.pdf")).toBe("application/pdf");
  });
  it("reads the extension case-insensitively", () => expect(fileExt("A.PPTX")).toBe("pptx"));
});
