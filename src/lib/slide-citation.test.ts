import { describe, expect, it } from "vitest";
import { parseSlideCitation, deckProxyUrl, parseSlideImage, slideImageUrl } from "./slide-citation";
import { citedPagesByDeck } from "./slide-citation";

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


describe("parseSlideImage", () => {
  it("parses a slide-img: src into deck stem and page", () => {
    expect(parseSlideImage("slide-img:U2-background#15")).toEqual({ deck: "U2-background", page: 15 });
  });
  it("returns null for other srcs", () => {
    expect(parseSlideImage("https://x/y.png")).toBeNull();
    expect(parseSlideImage("slide:U0-prelim#62")).toBeNull();
  });
});

describe("slideImageUrl", () => {
  it("builds the rendered-page image url", () => {
    expect(slideImageUrl(2, "U2-background", 15)).toBe("/api/modules/2/slide?name=U2-background&page=15");
  });
});

describe("citedPagesByDeck", () => {
  it("collects each deck's cited pages, deduped and sorted, and ignores slide images", () => {
    const md = "a [slide 9](slide:U3-memdef#9) b [slide 2](slide:U3-memdef#2) [again](slide:U3-memdef#9) ![fig](slide-img:U3-memdef#40) [x](slide:lab4-handout#2)";
    expect(citedPagesByDeck(md)).toEqual({ "U3-memdef": [2, 9], "lab4-handout": [2] });
  });
});
