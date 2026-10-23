// A small PDF writer for the demo's slide decks: 16:9 pages of a title,
// bullet points and the odd box diagram, set in the standard Helvetica fonts
// so nothing has to be embedded. Output is byte-for-byte deterministic (no
// dates, no ids), so scripts/make-demo-decks.ts can be re-run and the test
// can check the committed PDFs still match their source in decks.ts.

export type Figure = {
  kind: "boxes";
  // One box per entry, left to right; `tone` picks its fill.
  boxes: { label: string; tone: "done" | "sent" | "free" | "off" }[];
  legend: { tone: "done" | "sent" | "free" | "off"; label: string }[];
};
export type Slide = { title: string; bullets: string[]; figure?: Figure };
export type DeckSource = {
  title: string;        // on the cover
  subtitle: string;     // "CS3230 · Lecture 1"
  footer: string;       // "CS3230 L1 Asymptotics", followed by "· 3/15"
  slides: Slide[];      // pages 2 onwards; page 1 is the cover
};

const W = 960;
const H = 540;
const MARGIN = 64;

// Helvetica's advance widths (per 1000 em) for ASCII 32-126, from its AFM.
const ASCII_WIDTHS = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];
// The few characters outside ASCII the decks use, as WinAnsi codes.
const EXTRA: Record<string, [code: number, width: number]> = {
  "·": [0xb7, 278], "•": [0x95, 350], "–": [0x96, 556], "—": [0x97, 1000], "’": [0x92, 222], "×": [0xd7, 584],
};

// The string as WinAnsi bytes (one char per byte, for a latin1 buffer).
function winAnsi(s: string): string {
  let out = "";
  for (const ch of s) {
    const c = ch.charCodeAt(0);
    if (c >= 32 && c <= 126) out += ch;
    else if (EXTRA[ch]) out += String.fromCharCode(EXTRA[ch][0]);
    else throw new Error(`the deck text uses "${ch}", which Helvetica's WinAnsi encoding cannot show`);
  }
  return out;
}

export function textWidth(s: string, size: number, bold = false): number {
  let w = 0;
  for (const ch of s) {
    const c = ch.charCodeAt(0);
    w += c >= 32 && c <= 126 ? ASCII_WIDTHS[c - 32] : (EXTRA[ch]?.[1] ?? 556);
  }
  // Bold runs about 6% wider; close enough for line breaking.
  return (w * size * (bold ? 1.06 : 1)) / 1000;
}

export function wrap(text: string, size: number, maxWidth: number, bold = false): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (line && textWidth(next, size, bold) > maxWidth) { lines.push(line); line = word; } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

const esc = (s: string) => winAnsi(s).replace(/[\\()]/g, (c) => `\\${c}`);
const num = (n: number) => (Math.round(n * 100) / 100).toString();
const text = (font: "F1" | "F2", size: number, x: number, y: number, s: string, rgb = "0.11 0.12 0.15") =>
  `BT /${font} ${size} Tf ${rgb} rg ${num(x)} ${num(y)} Td (${esc(s)}) Tj ET\n`;
const rect = (x: number, y: number, w: number, h: number, fill: string, stroke?: string) =>
  `${fill} rg ${stroke ? `${stroke} RG 1.5 w ` : ""}${num(x)} ${num(y)} ${num(w)} ${num(h)} re ${stroke ? "B" : "f"}\n`;

const ACCENT = "0.17 0.36 0.66";
const GREY = "0.45 0.47 0.52";
const TONES: Record<Figure["boxes"][number]["tone"], string> = {
  done: "0.55 0.78 0.58", sent: "0.98 0.83 0.45", free: "0.82 0.89 0.98", off: "0.92 0.92 0.93",
};

function coverPage(deck: DeckSource, total: number): string {
  let s = rect(0, 0, 12, H, ACCENT);
  let y = 318;
  for (const line of wrap(deck.title, 46, W - 2 * MARGIN - 40, true)) { s += text("F2", 46, MARGIN + 16, y, line); y -= 56; }
  s += text("F1", 24, MARGIN + 16, y - 6, deck.subtitle, "0.25 0.27 0.32");
  s += text("F1", 16, MARGIN + 16, y - 44, "Demo course material, written for OpenPapr", GREY);
  return s + footer(deck, 1, total);
}

function footer(deck: DeckSource, page: number, total: number): string {
  return text("F1", 12, MARGIN, 26, `${deck.footer} · ${page}/${total}`, GREY);
}

function figure(f: Figure, top: number): string {
  let s = "";
  const size = 52, gap = 6;
  const width = f.boxes.length * size + (f.boxes.length - 1) * gap;
  let x = (W - width) / 2;
  const y = top - size;
  for (const b of f.boxes) {
    s += rect(x, y, size, size, TONES[b.tone], "0.35 0.37 0.42");
    s += text("F2", 20, x + (size - textWidth(b.label, 20, true)) / 2, y + 18, b.label);
    x += size + gap;
  }
  // The legend, one swatch and label after another on a single line.
  const items = f.legend.map((l) => ({ ...l, w: 22 + textWidth(l.label, 15) }));
  let lx = (W - (items.reduce((a, l) => a + l.w, 0) + 28 * (items.length - 1))) / 2;
  for (const l of items) {
    s += rect(lx, y - 40, 14, 14, TONES[l.tone], "0.35 0.37 0.42");
    s += text("F1", 15, lx + 22, y - 38, l.label, "0.25 0.27 0.32");
    lx += l.w + 28;
  }
  return s;
}

function contentPage(deck: DeckSource, slide: Slide, page: number, total: number): string {
  let s = rect(0, H - 8, W, 8, ACCENT);
  let y = H - 84;
  for (const line of wrap(slide.title, 34, W - 2 * MARGIN, true)) { s += text("F2", 34, MARGIN, y, line); y -= 42; }
  y -= 22;
  const size = slide.figure ? 22 : 25;
  const lead = size * 1.36;
  for (const b of slide.bullets) {
    const lines = wrap(b, size, W - 2 * MARGIN - 34);
    s += text("F1", size, MARGIN + 4, y, "•", ACCENT);
    for (const line of lines) { s += text("F1", size, MARGIN + 34, y, line); y -= lead; }
    y -= size * 0.5;
  }
  if (slide.figure) s += figure(slide.figure, Math.min(y + 6, 200));
  return s + footer(deck, page, total);
}

// The whole deck as PDF bytes.
export function deckPdf(deck: DeckSource): Uint8Array {
  const total = deck.slides.length + 1;
  const pages = [coverPage(deck, total), ...deck.slides.map((sl, i) => contentPage(deck, sl, i + 2, total))];
  const objs: string[] = [];
  const add = (body: string) => { objs.push(body); return objs.length; };
  const catalog = add("");
  const pagesId = add("");
  const f1 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const f2 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  const info = add(`<< /Title (${esc(`${deck.footer} - ${deck.title}`)}) /Producer (OpenPapr make-demo-decks) >>`);
  const kids: number[] = [];
  for (const content of pages) {
    const c = add(`<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}endstream`);
    kids.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${c} 0 R >>`));
  }
  objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objs[pagesId - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;

  let out = "%PDF-1.4\n%\xe2\xe3\xcf\xd3\n";
  const offsets: number[] = [];
  objs.forEach((body, i) => { offsets.push(Buffer.byteLength(out, "latin1")); out += `${i + 1} 0 obj\n${body}\nendobj\n`; });
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(out, "latin1"));
}
