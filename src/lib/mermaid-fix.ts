// Model-written mermaid breaks in a handful of predictable ways, nearly all of
// them punctuation inside a node or edge label: "A[Client (browser)]",
// "B{Is x > 0?}", "C[f(x): y]". Mermaid reads those brackets and colons as
// syntax. Quoting the label makes it plain text, so the diagram renders. This
// only rewrites labels that need it; everything else passes through.

const RISKY = /[()[\]{}:;,"'#&<>|=%@`]|[^\x00-\x7f]/;
const esc = (label: string) => label.trim().replace(/"/g, "#quot;");

const CLOSE: Record<string, string> = { "[": "]", "(": ")", "{": "}" };
// Characters right after the opening bracket that mean a different node shape
// ([( database, (( circle, [/ parallelogram, {{ hexagon) or an existing quote.
const SHAPE_NEXT = new Set(['"', "[", "(", "{", "/", "\\", ">"]);

// Rewrites one node label, found by matching brackets rather than a regex so
// that "A(Call foo(1))" is read as one label, not two.
function quoteNodes(line: string): string {
  let out = "";
  let i = 0;
  while (i < line.length) {
    const ch = line[i]!;
    const close = CLOSE[ch];
    const idMatch = close ? /([A-Za-z][\w-]*)$/.exec(out) : null;
    if (!close || !idMatch || SHAPE_NEXT.has(line[i + 1] ?? "")) { out += ch; i++; continue; }
    let depth = 0, j = i;
    for (; j < line.length; j++) {
      if (line[j] === ch) depth++;
      else if (line[j] === close && --depth === 0) break;
    }
    if (j >= line.length) { out += line.slice(i); break; }
    const text = line.slice(i + 1, j);
    out += RISKY.test(text) ? `${ch}"${esc(text)}"${close}` : line.slice(i, j + 1);
    i = j + 1;
  }
  return out;
}

export function quoteLabels(line: string): string {
  // Edge labels: -->|text|
  const edges = line.replace(/\|([^|"\n]+)\|/g, (m, text: string) => (RISKY.test(text) ? `|"${esc(text)}"|` : m));
  return quoteNodes(edges);
}

// Normalises a diagram before rendering. Only flowcharts get their labels
// quoted — other diagram types (sequence, class, state) have their own label
// rules, and their common failure is different enough to leave alone.
export function repairMermaid(src: string): string {
  let s = src.replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/\t/g, "  ").trim();
  const first = s.split("\n", 1)[0]!.trim();
  if (/^(flowchart|graph)\b/i.test(first)) {
    s = s.split("\n").map((l, i) => (i === 0 || /^\s*(%%|classDef|class |style |linkStyle|click )/.test(l) ? l : quoteLabels(l))).join("\n");
  }
  return s;
}

// Applies repairMermaid to every ```mermaid block of a markdown document, so
// guides are stored with diagrams that already render.
export function repairMermaidBlocks(markdown: string): string {
  return markdown.replace(/```mermaid[ \t]*\n([\s\S]*?)\n```/g, (_m, body: string) => "```mermaid\n" + repairMermaid(body) + "\n```");
}
