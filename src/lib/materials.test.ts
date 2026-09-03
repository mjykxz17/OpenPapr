import { describe, expect, it } from "vitest";
import { groupMaterials } from "./materials";

const row = (displayName: string, category: string | null, hidden = false) => ({ displayName, category, hidden });

describe("groupMaterials", () => {
  it("groups files by category in a fixed reading order, dropping empty groups", () => {
    const groups = groupMaterials([
      row("assignment1.pdf", "assignment"),
      row("Lect-1.pdf", "slides"),
      row("Seating.xlsx", "admin"),
      row("Lect-2.pdf", "slides"),
      row("Burp walkthrough.pdf", "tutorial"),
    ]);
    expect(groups.map((g) => g.label)).toEqual(["Lecture slides", "Tutorials and labs", "Assignments", "Admin"]);
    expect(groups[0]!.files.map((f) => f.displayName)).toEqual(["Lect-1.pdf", "Lect-2.pdf"]);
  });

  it("puts uncategorised files in their own group after the named ones, and images last", () => {
    const groups = groupMaterials([row("banner.png", "image"), row("mystery.pdf", null), row("ch1.pdf", "reading")]);
    expect(groups.map((g) => g.label)).toEqual(["Readings", "Uncategorised", "Images"]);
  });

  it("returns nothing for a module with no files", () => {
    expect(groupMaterials([])).toEqual([]);
  });
});
