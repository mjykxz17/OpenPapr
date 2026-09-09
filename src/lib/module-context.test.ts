import { describe, expect, it } from "vitest";
import { contextPromptBlock, meaningfulNotes, NOTES_TEMPLATE, renderModuleContext, type ModuleContextInput } from "./module-context";

const base: ModuleContextInput = {
  code: "IFS4103",
  name: "IFS4103 Penetration Testing Practice [2610]",
  term: "2026/2027 Semester 1",
  components: [
    { name: "Final", weightPct: 40, source: "canvas_api" },
    { name: "Practical", weightPct: 60, source: "llm_syllabus" },
    { name: "Unknown", weightPct: null, source: "manual" },
  ],
  decks: ["IFS4103-Lect-1-v1-3", "IFS4103-Lect-2-v1-2"],
  profile: null,
  notes: null,
};

describe("renderModuleContext", () => {
  it("leads with the code and a title stripped of the code and term tag", () => {
    const md = renderModuleContext(base);
    expect(md.split("\n")[0]).toBe("# IFS4103 Penetration Testing Practice");
    expect(md).toContain("Term: 2026/2027 Semester 1");
  });

  it("lists weighted components heaviest first, with their provenance, and skips unweighted ones", () => {
    const md = renderModuleContext(base);
    expect(md).toContain("## Assessment\n- Practical: 60% (read from the syllabus)\n- Final: 40% (from Canvas)");
    expect(md).not.toContain("Unknown");
  });

  it("numbers the decks in order", () => {
    expect(renderModuleContext(base)).toContain("## Lecture decks, in order\n1. IFS4103-Lect-1-v1-3\n2. IFS4103-Lect-2-v1-2");
  });

  it("omits sections it has nothing for", () => {
    const md = renderModuleContext({ ...base, components: [], decks: [], term: null });
    expect(md).toBe("# IFS4103 Penetration Testing Practice\n");
  });

  it("includes the observed profile and the student's notes when present", () => {
    const md = renderModuleContext({ ...base, profile: "Teaches from live demos.", notes: "## Exam\nOpen book." });
    expect(md).toContain("## The module and its lecturer, as observed from the decks\nTeaches from live demos.");
    expect(md).toContain("## Notes from the student\n## Exam\nOpen book.");
  });

  it("keeps a name that is only the code", () => {
    expect(renderModuleContext({ ...base, name: "CS1010" , code: "CS1010", term: null, components: [], decks: [] }))
      .toBe("# CS1010 CS1010\n");
  });
});

describe("meaningfulNotes", () => {
  it("drops the untouched template entirely", () => {
    expect(meaningfulNotes(NOTES_TEMPLATE)).toBeNull();
  });

  it("keeps only the sections the student actually filled in", () => {
    const filled = NOTES_TEMPLATE.replace(
      "(Open or closed book, question style, what past papers looked like, what was said in class about the exam.)",
      "Closed book, two long questions.",
    );
    expect(meaningfulNotes(filled)).toBe("## Assessment and exam format\nClosed book, two long questions.");
  });

  it("passes free-form notes through", () => {
    expect(meaningfulNotes("Prof uses AT&T syntax.")).toBe("Prof uses AT&T syntax.");
  });

  it("returns null for empty input", () => {
    expect(meaningfulNotes(null)).toBeNull();
    expect(meaningfulNotes("   ")).toBeNull();
  });
});

describe("contextPromptBlock", () => {
  it("is empty when there is no context", () => {
    expect(contextPromptBlock(null)).toBe("");
    expect(contextPromptBlock("  ")).toBe("");
  });

  it("fences the context and tells the model not to cite it", () => {
    const block = contextPromptBlock("# CS1010\n");
    expect(block).toContain("=== MODULE CONTEXT ===\n# CS1010\n=== END MODULE CONTEXT ===");
    expect(block).toMatch(/never cite it/);
  });
});
