import { describe, expect, it } from "vitest";
import { variantGroups, variantStem } from "./variants";

describe("variants", () => {
  it("strips a trailing group code only", () => {
    expect(variantStem("Indemnity Form (TD11) ")).toBe("Indemnity Form");
    expect(variantStem("Lab report - G03")).toBe("Lab report");
    expect(variantStem("Tutorial 3")).toBeNull();
    expect(variantStem("Quiz10")).toBeNull();
    expect(variantStem("Assignment3-PartB")).toBeNull();
    expect(variantStem("Indemnity Forms Submission")).toBeNull();
  });
  it("groups four or more with the same stem, module and day", () => {
    const due = Date.UTC(2026, 9, 9, 15, 59);
    const rows = ["TD1", "TD2", "TE1", "TE2"].map((c, i) => ({ id: i + 1, moduleId: 6, type: "assignment", title: `Indemnity Form (${c})`, dueAt: due }));
    const g = variantGroups([...rows, { id: 9, moduleId: 6, type: "assignment", title: "Indemnity Forms Submission", dueAt: due }]);
    expect(g.get(1)).toMatchObject({ stem: "Indemnity Form", ids: [1, 2, 3, 4] });
    expect(g.has(9)).toBe(false);
    expect(variantGroups(rows.slice(0, 3)).size).toBe(0);
  });
});
