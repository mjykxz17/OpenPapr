import { describe, expect, it } from "vitest";
import { parseSlideCitation, deckProxyUrl } from "./slide-citation";

describe("parseSlideCitation", () => {
  it("parses a slide: href into deck stem and page", () => {
    expect(parseSlideCitation("slide:U0-prelim#62")).toEqual({ deck: "U0-prelim", page: 62 });
  });
  it("handles deck stems with hyphens", () => {
    expect(parseSlideCitation("slide:C-part2-pointers#14")).toEqual({ deck: "C-part2-pointers", page: 14 });
  });
  it("returns null for non-slide hrefs", () => {
    expect(parseSlideCitation("https://example.com")).toBeNull();
    expect(parseSlideCitation("slide:missing-page")).toBeNull();
    expect(parseSlideCitation("slide:deck#notanumber")).toBeNull();
  });
});

describe("deckProxyUrl", () => {
  it("builds a proxy url with the page fragment for the PDF viewer", () => {
    expect(deckProxyUrl(2, "U0-prelim", 62)).toBe("/api/modules/2/deck?name=U0-prelim#page=62");
  });
  it("url-encodes the deck name", () => {
    expect(deckProxyUrl(2, "C part1", 3)).toBe("/api/modules/2/deck?name=C%20part1#page=3");
  });
});
