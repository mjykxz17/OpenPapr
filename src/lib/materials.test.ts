import { describe, expect, it } from "vitest";
import { categoryLabel, sortMaterials } from "./materials";

const row = (displayName: string, category: string | null) => ({ displayName, category });

describe("sortMaterials", () => {
  it("orders by category in reading order, then by name naturally", () => {
    const sorted = sortMaterials([
      row("Seating.xlsx", "admin"),
      row("Lect-10.pdf", "slides"),
      row("assignment1.pdf", "assignment"),
      row("Lect-2.pdf", "slides"),
      row("Burp walkthrough.pdf", "tutorial"),
    ]);
    expect(sorted.map((r) => r.displayName)).toEqual(["Lect-2.pdf", "Lect-10.pdf", "Burp walkthrough.pdf", "assignment1.pdf", "Seating.xlsx"]);
  });

  it("puts uncategorised files after every named category and images last", () => {
    const sorted = sortMaterials([row("banner.png", "image"), row("mystery.pdf", null), row("ch1.pdf", "reading")]);
    expect(sorted.map((r) => r.displayName)).toEqual(["ch1.pdf", "mystery.pdf", "banner.png"]);
  });
});

describe("categoryLabel", () => {
  it("names each category for display, and null as uncategorised", () => {
    expect(categoryLabel("slides")).toBe("Lecture slides");
    expect(categoryLabel("practice")).toBe("Practice and past papers");
    expect(categoryLabel(null)).toBe("Uncategorised");
  });
});
