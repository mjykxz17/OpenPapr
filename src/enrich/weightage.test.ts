import { describe, expect, it, vi } from "vitest";
import { createWeightageExtractor } from "./weightage";

const mkClient = (impl: (args: unknown) => Promise<unknown>) => ({ messages: { parse: vi.fn(impl) } }) as never;
const good = { found: true, components: [
  { name: "Final exam", weight_pct: 25, evidence: "Final exam: 25%" },
  { name: "tP", weight_pct: 45, evidence: "team project (45%)" },
  { name: "iP", weight_pct: 15, evidence: "iP 15%" },
  { name: "Participation", weight_pct: 15, evidence: "participation 15%" },
]};

describe("createWeightageExtractor", () => {
  it("returns camelCased components when weights sum to ~100", async () => {
    const ex = createWeightageExtractor(mkClient(async () => ({ parsed_output: good })), "m");
    const out = await ex([{ label: "syllabus", text: "..." }]);
    expect(out).toHaveLength(4);
    expect(out![0]).toEqual({ name: "Final exam", weightPct: 25, evidence: "Final exam: 25%" });
  });
  it("returns null when the sum is far from 100", async () => {
    const bad = { ...good, components: good.components.slice(0, 2) }; // sums to 70
    const ex = createWeightageExtractor(mkClient(async () => ({ parsed_output: bad })), "m");
    expect(await ex([{ label: "s", text: "x" }])).toBeNull();
  });
  it("returns null when found=false, with no fabrication", async () => {
    const ex = createWeightageExtractor(mkClient(async () => ({ parsed_output: { found: false, components: [] } })), "m");
    expect(await ex([{ label: "s", text: "no weightage here" }])).toBeNull();
  });
  it("returns null with no sources without calling the LLM", async () => {
    const parse = vi.fn();
    const ex = createWeightageExtractor({ messages: { parse } } as never, "m");
    expect(await ex([])).toBeNull();
    expect(parse).not.toHaveBeenCalled();
  });
  it("returns null on errors", async () => {
    const ex = createWeightageExtractor(mkClient(async () => { throw new Error("boom"); }), "m");
    expect(await ex([{ label: "s", text: "x" }])).toBeNull();
  });
  it("sends PDFs as document blocks", async () => {
    const parse = vi.fn(async () => ({ parsed_output: good }));
    const ex = createWeightageExtractor({ messages: { parse } } as never, "m");
    await ex([{ label: "s", text: "x" }], [{ label: "syllabus.pdf", base64: "QUJD" }]);
    const req = (parse.mock.calls[0] as any[])[0] as { messages: { content: { type: string }[] }[] };
    expect(req.messages[0].content.some((b) => b.type === "document")).toBe(true);
  });
});
