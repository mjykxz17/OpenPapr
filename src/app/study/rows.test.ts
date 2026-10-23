import { describe, expect, it } from "vitest";
import { studyRows } from "./rows";

const mod = (id: number, code: string, position: number, hidden = false) => ({ id, code, name: `${code} name`, hidden, position });
const idle = () => ({ writing: null, ready: 0, total: 0 });

describe("studyRows", () => {
  it("lists every module, with a guide or not, guides first", () => {
    const rows = studyRows(
      [mod(1, "CS2040", 0), mod(2, "MA1521", 1), mod(3, "GEA1000", 2)],
      [{ moduleId: 2, title: "Calculus", sourceNote: "auto · gpt", generatedAt: 100 }],
      idle, true,
    );
    expect(rows.map((r) => r.code)).toEqual(["MA1521", "CS2040", "GEA1000"]);
    expect(rows[0]!.guide?.title).toBe("Calculus");
    expect(rows[1]!.note).toBe("No guide yet · writes itself when slides arrive");
  });
  it("says what is happening to a guide that isn't ready", () => {
    const rows = studyRows([mod(1, "CS2040", 0)], [], () => ({ writing: "Graphs", ready: 1, total: 4 }), true);
    expect(rows[0]!.note).toBe("No guide yet · writing “Graphs”");
    expect(studyRows([mod(1, "CS2040", 0)], [], idle, false)[0]!.note).toMatch(/turn on AI/);
  });
  it("leaves out a module hidden from home unless it has a guide", () => {
    const rows = studyRows([mod(1, "OLD1000", 0, true), mod(2, "OLD2000", 1, true)],
      [{ moduleId: 2, title: null, sourceNote: null, generatedAt: 5 }], idle, true);
    expect(rows.map((r) => r.code)).toEqual(["OLD2000"]);
  });
  it("orders guides newest first and the rest in home order", () => {
    const rows = studyRows([mod(1, "A", 2), mod(2, "B", 1), mod(3, "C", 0), mod(4, "D", 3)],
      [{ moduleId: 1, title: null, sourceNote: null, generatedAt: 1 }, { moduleId: 4, title: null, sourceNote: null, generatedAt: 9 }], idle, true);
    expect(rows.map((r) => r.code)).toEqual(["D", "A", "C", "B"]);
  });
});
