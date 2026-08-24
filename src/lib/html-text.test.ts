import { describe, expect, it } from "vitest";
import { htmlToText } from "./html-text";

describe("htmlToText", () => {
  it("strips tags and keeps the text", () => {
    expect(htmlToText("<p>Hi Everyone,</p>")).toBe("Hi Everyone,");
  });
  it("removes script/style blocks entirely, including their content", () => {
    expect(htmlToText('<p>Text</p><script src="x">var junk=1;</script>')).toBe("Text");
  });
  it("turns paragraph and <br> boundaries into newlines", () => {
    expect(htmlToText("<p>A</p><p>B</p>")).toBe("A\nB");
    expect(htmlToText("Line1<br>Line2")).toBe("Line1\nLine2");
  });
  it("decodes common and numeric HTML entities", () => {
    expect(htmlToText("Tom &amp; Jerry&#39;s &ldquo;quote&rdquo;&nbsp;end")).toBe("Tom & Jerry's “quote” end");
  });
  it("collapses runs of whitespace and blank lines", () => {
    expect(htmlToText("<p>a</p>\n\n\n<p>b</p>")).toBe("a\nb");
  });
  it("returns empty string for null/empty", () => {
    expect(htmlToText(null)).toBe("");
    expect(htmlToText("")).toBe("");
  });
});
