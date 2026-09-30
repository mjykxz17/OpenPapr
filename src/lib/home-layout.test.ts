import { describe, expect, it } from "vitest";
import { DEFAULT_LAYOUT, normalizeLayout, parseLayout } from "./home-layout";

describe("home layout", () => {
  it("falls back to the default", () => {
    expect(parseLayout(null)).toEqual(DEFAULT_LAYOUT);
    expect(parseLayout("not json")).toEqual(DEFAULT_LAYOUT);
  });
  it("keeps order, fixes bad sizes, drops junk and adds new widgets", () => {
    const l = normalizeLayout([
      { id: "modules", size: "L" }, { id: "next", size: "F" }, { id: "nope", size: "S" }, { id: "modules", size: "W" }, { id: "week", size: "W", hidden: true },
    ]);
    expect(l.slice(0, 3)).toEqual([
      { id: "modules", size: "L", hidden: false }, { id: "next", size: "S", hidden: false }, { id: "week", size: "W", hidden: true },
    ]);
    expect(l.map((s) => s.id).sort()).toEqual(["done", "due", "modules", "next", "today", "week"]);
  });
});
