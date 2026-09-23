import { describe, expect, it } from "vitest";
import mermaid from "mermaid";
import { quoteLabels, repairMermaid, repairMermaidBlocks } from "./mermaid-fix";

// Under node mermaid parses fine but then trips on DOMPurify, which it only
// needs for rendering; a syntax problem throws a parse error first.
async function parses(code: string): Promise<boolean> {
  try { await mermaid.parse(code); return true; } catch (e) { return !/Parse error|Lexical error|Syntax error|Expecting/.test(String(e)); }
}

describe("quoteLabels", () => {
  it("quotes labels that carry syntax characters", () => {
    expect(quoteLabels("A[Client (browser)] --> B{Is x > 0?}")).toBe('A["Client (browser)"] --> B{"Is x > 0?"}');
    expect(quoteLabels("A -->|calls f(x)| B")).toBe('A -->|"calls f(x)"| B');
    expect(quoteLabels("C(Step: one)")).toBe('C("Step: one")');
    expect(quoteLabels("A(Call foo(1)) --> B")).toBe('A("Call foo(1)") --> B');
  });
  it("leaves plain and already-quoted labels alone", () => {
    expect(quoteLabels("A[Client] --> B(Server)")).toBe("A[Client] --> B(Server)");
    expect(quoteLabels('A["already (fine)"]')).toBe('A["already (fine)"]');
    expect(quoteLabels("A[(Database)]")).toBe("A[(Database)]");
    expect(quoteLabels("A((Circle)) --> B{{Hex}}")).toBe("A((Circle)) --> B{{Hex}}");
  });
  it("escapes quotes inside a label", () => {
    expect(quoteLabels('A[say "hi": now]')).toBe('A["say #quot;hi#quot;: now"]');
  });
});

describe("repairMermaid", () => {
  const broken = [
    "flowchart LR\n  A[Client (browser)] --> B[Server: nginx]\n  B -->|HTTP (TLS)| C{Auth ok?}",
    "flowchart TD\n  A(Call foo(1)) --> B[Result: {ok}]",
    "graph LR\n  S[Stack (grows down)] -->|push (x)| T[Top]",
  ];
  it.each(broken)("turns a diagram mermaid rejects into one it accepts", async (src) => {
    expect(await parses(src)).toBe(false);
    expect(await parses(repairMermaid(src))).toBe(true);
  });
  it("does not touch sequence diagrams", () => {
    const seq = "sequenceDiagram\n  A->>B: hello (world)";
    expect(repairMermaid(seq)).toBe(seq);
  });
  it("keeps styling lines as they are", () => {
    const src = "flowchart LR\n  A[x: y] --> B\n  classDef hot fill:#f00\n  style A fill:#fff";
    expect(repairMermaid(src).split("\n").slice(2)).toEqual(["  classDef hot fill:#f00", "  style A fill:#fff"]);
  });
});

describe("repairMermaidBlocks", () => {
  it("repairs only mermaid fences", () => {
    const md = "Text A[x (y)]\n\n```mermaid\nflowchart LR\n  A[x (y)] --> B\n```\n\n```js\nA[x (y)]\n```";
    expect(repairMermaidBlocks(md)).toBe("Text A[x (y)]\n\n```mermaid\nflowchart LR\n  A[\"x (y)\"] --> B\n```\n\n```js\nA[x (y)]\n```");
  });
});
