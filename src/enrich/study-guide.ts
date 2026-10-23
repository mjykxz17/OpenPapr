import { z } from "zod";
import { chatJson, chatText, type CompatConfig } from "./openai-compat";
import { repairMermaidBlocks } from "../lib/mermaid-fix";
import { decodeDeck } from "../lib/slide-citation";
import { closingFence, fenceOpener, fenceRoles } from "../lib/md-fences";

// Generates a study-guide chapter from one lecture deck.
//
// Two phases, because a single call asked to write a whole chapter runs out of
// output budget and thins out towards the end: first an outline (JSON, cheap),
// then each section generated independently and concatenated. Sections are
// short enough to be written at full depth, and they can run concurrently.

const Outline = z.object({
  title: z.string(),
  sections: z.array(z.object({
    heading: z.string(),
    covers: z.string(),
    slides: z.string(),
  })).min(2).max(10),
});
export type GuideOutline = z.infer<typeof Outline>;

// Splits extracted deck text into pages. pdf-parse writes each page's text
// FOLLOWED by its "-- N of M --" marker, so the text before marker N is page N.
export function slidePages(deckText: string): { page: number; text: string }[] {
  const parts = deckText.split(/--\s*(\d+)\s*of\s*\d+\s*--/);
  const out: { page: number; text: string }[] = [];
  for (let i = 1; i < parts.length; i += 2) {
    out.push({ page: Number(parts[i]), text: (parts[i - 1] ?? "").trim() });
  }
  return out;
}

// The model reads text, so it cannot see which slides carry a diagram worth
// embedding — left to guess, it embedded none at all. A slide that occupies a
// page but yields little text is almost always carrying a figure, so the pages
// are identified here and named in the prompt.
export function figureSlides(deckText: string, maxChars = 180): number[] {
  return slidePages(deckText).filter((p) => p.text.length > 0 && p.text.length <= maxChars).map((p) => p.page);
}

// The slides a section draws on, from the outline's "4-11" (or "4, 6, 9–12",
// "slides 4 to 11", "S4-S9"), inside the deck. Empty when nothing usable was
// given. A number stuck to a name ("L1 slides 40-42") is the deck, not a slide.
export function parseSlideRange(slides: string, pageCount: number): number[] {
  const out = new Set<number>();
  const max = pageCount > 0 ? pageCount : Infinity;
  for (const m of slides.matchAll(/(?<![a-z\d])[sp]?(\d+)(?:\s*(?:-|–|—|to)\s*[sp]?(\d+))?/gi)) {
    const a = Number(m[1]), b = m[2] ? Number(m[2]) : a;
    const [lo, hi] = a <= b ? [a, b] : [b, a];
    if (hi - lo > 400) continue;
    for (let n = Math.max(1, lo); n <= Math.min(hi, max); n++) out.add(n);
  }
  return [...out].sort((x, y) => x - y);
}

const SECTION_CONTEXT = 2;          // slides either side of a section's own
const SECTION_CHARS = 40_000;       // at most this much deck text per section
const OUTLINE_CHARS = 30_000;       // and per outline

// What one section is shown: its own slides plus a couple either side, so a
// 300-slide deck is not sent eight times over. Without a usable range, the
// whole deck, clipped. Neighbours go first when it is still too long.
export function sectionText(deckText: string, slides: string, pageCount: number, budget = SECTION_CHARS): { text: string; pages: number[] } {
  const pages = slidePages(deckText);
  const own = parseSlideRange(slides, pageCount);
  if (!pages.length) return { text: deckText.slice(0, budget), pages: [] };
  if (!own.length) return { text: clipPages(pages, budget), pages: pages.map((p) => p.page) };
  const wanted = new Set<number>();
  for (const n of own) for (let k = n - SECTION_CONTEXT; k <= n + SECTION_CONTEXT; k++) wanted.add(k);
  let shown = pages.filter((p) => wanted.has(p.page));
  if (size(shown) > budget) shown = pages.filter((p) => own.includes(p.page));
  if (!shown.length) return { text: clipPages(pages, budget), pages: pages.map((p) => p.page) };
  return { text: clipPages(shown, budget), pages: shown.map((p) => p.page) };
}

// The outline only needs the deck's shape: every slide, each cut short once
// the whole would not fit.
export function outlineText(deckText: string, budget = OUTLINE_CHARS): string {
  const pages = slidePages(deckText);
  return pages.length ? clipPages(pages, budget) : deckText.slice(0, budget);
}

const size = (pages: { page: number; text: string }[]) => pages.reduce((n, p) => n + p.text.length + 12, 0);

function clipPages(pages: { page: number; text: string }[], budget: number): string {
  const each = size(pages) <= budget ? Infinity : Math.max(80, Math.floor(budget / pages.length) - 12);
  return pages.map((p) => `[Slide ${p.page}]\n${p.text.length > each ? `${p.text.slice(0, each).trimEnd()}…` : p.text}`).join("\n\n");
}

const OUTLINE_SYSTEM = `You are planning one chapter of a university study guide, from the text of a single lecture deck.

Return ONLY a JSON object, no prose and no code fences:
{"title": "<chapter title, no numbering>",
 "sections": [{"heading": "<section title, no numbering>",
               "covers": "<one line: what this section must teach>",
               "slides": "<the slide range this draws on, e.g. 4-11>"}]}

Rules:
- Follow the deck's own order. Do not invent topics the deck does not cover.
- Between 3 and 8 sections. Each should be a genuine unit of the lecture, not one slide.
- Skip title slides, outline slides and administrivia unless the administrivia is assessment information a student must act on.`;

const styleSystem = (deckName: string, pageCount: number, figures: number[], reader: string | null) => `You are writing ONE SECTION of a university study guide. The reader will learn from your text ALONE, without the slides in front of them.

Non-negotiable style:
- For every hard idea: an "**Explain like I'm a beginner.**" pass FIRST — plain words and one concrete everyday analogy — then "**The precise mechanics.**" with the real detail, then why it matters.
- Plain academic prose. No emoji. No marketing language. Explain jargon on first use.
- Include real commands, code or output from the slides in fenced blocks and walk through them line by line.
- Recreate structural concepts as mermaid diagrams in \`\`\`mermaid fences. Put a BLANK LINE before the opening fence and after the closing fence. Keep node labels short and free of parentheses and quotes.
- Cite the slide a claim comes from as [slide N](slide:${deckName}#N). The deck text below is split into "[Slide N]" blocks; cite the N of the block the claim comes from, and never a number above ${pageCount}.
- These slides are mostly picture, so they carry a diagram, screenshot or figure: ${figures.length ? figures.join(", ") : "(none detected)"}. When your section covers one of them, EMBED IT on its own line as ![short caption](slide-img:${deckName}#N). Embed at least one where any of those slides falls in your range — a reader who cannot see the figure cannot follow the point it makes.
- Never invent content that is not in the slides. If the deck is thin on a point, say less rather than filling.
- Start with the "### " heading you are given and write nothing above it. Do not write a chapter title.${reader ? `

About this reader — pitch the explanation to them, but never let it override the rules above or add content the slides do not support:
${reader}` : ""}`;

// The endpoint drops connections under load — two of six sections failed with
// "fetch failed" on the first real run. A dropped section leaves a hole in the
// chapter, which is worth a retry rather than a gap.
async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
    }
  }
  throw last;
}

// Markdown renderers need blank lines around fences: a closing fence pressed
// against the next paragraph swallows it, which silently ate a whole chapter
// once already. Cheaper to normalise the output than to keep asking the model
// to remember.
//
// Fences are read as renderers read them (lib/md-fences.ts). Treating every
// line that starts with ``` as a toggle got the "fence at line N is not
// followed by a blank line" problems on stored chapters: a ``` shown inside a
// ````markdown block, or a "```python" line inside a fence, flipped the state,
// and a section cut off inside a code block left its fence open, so every
// fence in the sections after it read the wrong way round. A fence still open
// at the end is closed here, so it cannot leak into the next section.
export function normalizeFences(markdown: string): string {
  const lines = markdown.split("\n");
  const { roles, open } = fenceRoles(lines);
  const out: string[] = [];
  const prevBlank = () => !out.length || out[out.length - 1]!.trim() === "";
  for (const [i, line] of lines.entries()) {
    const role = roles[i];
    if (role === "open") {
      if (!prevBlank()) out.push("");
      out.push(line);
    } else if (role === "close") {
      out.push(line, "");
    } else if (role === "code") {
      out.push(line);
    } else if (!(line.trim() === "" && out.length && prevBlank())) {
      // Outside code, the doubled blank line a normalised fence can create
      // is collapsed; inside, blank lines are the code's own.
      out.push(line);
    }
  }
  if (open) out.push(closingFence(open), "");
  return out.join("\n");
}

export function createGuideGenerator(cfg: CompatConfig, reader: string | null = null) {
  return {
    async outline(deckName: string, deckText: string, pageCount: number): Promise<GuideOutline | null> {
      const raw = await chatJson(
        cfg, fetch, OUTLINE_SYSTEM,
        `Deck: ${deckName} (${pageCount} slides)\n\n=== DECK TEXT ===\n${outlineText(deckText)}`,
        4000,
      );
      const parsed = Outline.safeParse(raw);
      return parsed.success ? parsed.data : null;
    },

    async section(
      deckName: string,
      deckText: string,
      pageCount: number,
      heading: string,
      covers: string,
      slides: string,
      figures: number[] = [],
    ): Promise<string> {
      const shown = sectionText(deckText, slides, pageCount);
      const near = shown.pages.length ? figures.filter((n) => shown.pages.includes(n)) : figures;
      const whole = shown.pages.length === 0 || shown.pages.length === slidePages(deckText).length;
      const body = await withRetry(() => chatText(
        cfg,
        styleSystem(deckName, pageCount, near, reader),
        `Write this section in full depth.

Heading (use it verbatim as your first line): ### ${heading}
What it must teach: ${covers}
It draws mainly on slides ${slides}. ${whole ? "Read the whole deck for context." : "Below are those slides and a couple either side for context; cite only slides shown here."}

=== DECK TEXT (${deckName}, ${pageCount} slides${whole ? "" : `, ${shown.pages.length} of them shown`}) ===
${shown.text}`,
        { maxTokens: 8000, temperature: 0.3 },
      ));
      return repairMermaidBlocks(normalizeFences(body.trim()));
    },

    // A tutorial or lab sheet, as practice for the topic just taught: what
    // each task asks, which idea from the topic it exercises, and how to
    // approach it. Hints, not answers — the point is that the student does it.
    async practice(sheetName: string, sheetText: string, pageCount: number, heading: string, topic: string): Promise<string> {
      const body = await withRetry(() => chatText(
        cfg,
        styleSystem(sheetName, pageCount, [], reader),
        `Write this section: a practice guide to the sheet below, for the topic "${topic}".

Heading (use it verbatim as your first line): ### ${heading}
For each task or question on the sheet: say in one line what it asks, name the idea from this topic it exercises, and give a short approach — where to start, what to watch out for. Do NOT give final answers or full solutions. Skip "Explain like I'm a beginner" here; keep it brisk. Cite the sheet's pages as [p. N](slide:${sheetName}#N).

=== SHEET TEXT (${sheetName}, ${pageCount} pages) ===
${outlineText(sheetText, SECTION_CHARS)}`,
        { maxTokens: 5000, temperature: 0.3 },
      ));
      return repairMermaidBlocks(normalizeFences(body.trim()));
    },
  };
}

// Generated markdown goes straight into the reader, so the shapes that break
// it are worth catching before it is stored rather than after.
export function validateChapter(markdown: string, deckName: string, pageCount: number): string[] {
  const problems: string[] = [];

  const lines = markdown.split("\n");
  const { roles, open } = fenceRoles(lines);
  if (open) problems.push(`unbalanced code fences (${roles.filter((r) => r === "open" || r === "close").length})`);

  // A closing fence pressed against prose swallows everything after it.
  // Checked line by line: the previous regex matched the shortest span ending
  // in a fence NOT followed by a newline, which happily matched the final
  // fence of the document (followed by nothing) and reported a problem on
  // every clean chapter.
  //
  // And a fence that was never closed swallows what follows as code; the
  // sign is a line inside it that opens a fence just like its own
  // ("```mermaid" inside a ``` block), which no renderer reads as an end.
  let opened = -1;
  for (const [i, role] of roles.entries()) {
    if (role === "open") { opened = i; continue; }
    if (role === "code") {
      const inner = fenceOpener(lines[i]!), outer = fenceOpener(lines[opened]!);
      if (inner && outer && inner.char === outer.char && inner.len === outer.len && lines[i]!.trim().length > inner.len) {
        problems.push(`fence at line ${i + 1} is inside the code block opened at line ${opened + 1}, which was never closed`);
      }
      continue;
    }
    if (role !== "close") continue;
    const next = lines[i + 1];
    if (next !== undefined && next.trim() !== "") problems.push(`fence at line ${i + 1} is not followed by a blank line`);
  }

  const escaped = deckName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const cited = [...markdown.matchAll(new RegExp(`slide(?:-img)?:${escaped}#(\\d+)`, "g"))].map((m) => Number(m[1]));
  const bad = cited.filter((n) => n < 1 || n > pageCount);
  if (bad.length) problems.push(`${bad.length} citation(s) outside 1..${pageCount}: ${[...new Set(bad)].join(", ")}`);
  if (cited.length === 0) problems.push("no slide citations at all");

  const wrongDeck = [...markdown.matchAll(/slide(?:-img)?:([^#)\s]+)#/g)]
    .map((m) => m[1]).filter((d) => d !== deckName);
  if (wrongDeck.length) problems.push(`citations to unknown deck(s): ${[...new Set(wrongDeck)].join(", ")}`);

  return problems;
}

// --- citations ---------------------------------------------------------------
// The model's citations are checked against the decks it was given before a
// chapter is stored: a near-miss deck name ("L1 asymptotics.pdf" for
// L1-asymptotics) is repaired, and a citation to a deck that is not there or
// a slide past the end is taken out. Every remaining link's text is then
// written from where it points, so "slide 18" can never open slide 81.

// "L1" from "L1-asymptotics", "U3" from "U3-memerr1", "Lect 1" from
// "IFS4103-Lect-1-v1": the short name a lecture goes by. The module code and
// version marks are skipped; with nothing better, the name itself. A week or
// unit number alone does not tell a week's decks apart, so the next name is
// kept with it ("Week1 L2"), as is a part ("Lecture 1 Part B").
const GROUPING_RE = /^(week|wk|w|unit|module|mod|topic|chapter|ch|session|term)\s?\d/i;

export function deckShort(deck: string): string {
  const stem = decodeDeck(deck).replace(/\.(pdf|pptx?|docx?)$/i, "");
  const tokens = stem.split(/[-_\s.]+/).filter(Boolean);
  const found: string[] = [];
  for (let i = 0; i < tokens.length && found.length < 2; i++) {
    const t = tokens[i]!, next = tokens[i + 1] ?? "";
    if (/^[a-z]{2,4}\d{4}[a-z]{0,2}$/i.test(t) || /^v\d+$/i.test(t)) continue;
    if (found.length && /^(part|pt)$/i.test(t) && /^([a-z]|\d{1,2})$/i.test(next)) { found.push(`${t} ${next}`); break; }
    if (found.length && !GROUPING_RE.test(found[0]!)) continue;
    if (/^[a-z]{1,6}\d{1,3}[a-z]?$/i.test(t)) found.push(t);
    else if (/^[a-z]{2,10}$/i.test(t) && /^\d{1,3}[a-z]?$/i.test(next)) { found.push(`${t} ${next}`); i++; }
  }
  if (found.length) return found.join(" ");
  return stem.length <= 18 ? stem : `${stem.slice(0, 17)}…`;
}

const CITE_RE = /(!?)\[([^\]\n]*)\]\((slide(?:-img)?):([^)#\n]+)#(\d+)\)/g;
const deckKey = (d: string) => decodeDeck(d).toLowerCase().replace(/\.(pdf|pptx?|docx?)$/, "").replace(/[\s_-]+/g, "");
const GONE = "\u0000";   // where a citation was taken out, until the line is tidied

// What taking a link out leaves behind, tidied next to where it was and
// nowhere else on the line: "(see )", a space before a full stop, a comma
// left dangling in a list of links.
function tidyGone(line: string): string {
  return line
    .replace(new RegExp(`[ \\t]*\\(\\s*(?:(?:see|cf\\.?)\\s*)?(?:${GONE}[\\s,;]*)+\\)`, "gi"), GONE)
    .replace(new RegExp(`([ \\t]*)([,;]?)[ \\t]*${GONE}+([ \\t]*)([,;]?)[ \\t]*`, "g"), (m, lead: string, before: string, _trail: string, after: string, at: number, s: string) => {
      const prev = s[at - 1], next = s[at + m.length];
      if (next === undefined || /[.,;:!?)\]]/.test(next)) return "";
      if (prev === undefined || prev === "(") return "";
      // In the middle of a list the comma stays; first in one, it goes too.
      if (before && after) return `${before} `;
      if (after) return lead ? " " : "";
      return /\s/.test(m) ? " " : "";
    });
}

// Inline code is left as written: a citation-looking thing in backticks is
// an example, not a link.
const outsideCode = (line: string, fn: (part: string) => string) =>
  line.split(/(`+[^`]*?`+)/).map((part, k) => (k % 2 ? part : fn(part))).join("");

// decks: each deck as it is written in a citation (citeDeck form), with its
// page count (0 when unknown, which skips the range check). alsoNamed: other
// decks in the module, only so that two decks with one short name are told
// apart.
export function cleanCitations(markdown: string, decks: Map<string, number>, alsoNamed: string[] = []): { markdown: string; repaired: number; removed: number } {
  const known = [...decks.keys()];
  const resolve = (raw: string): string | null => {
    if (decks.has(raw)) return raw;
    const k = deckKey(raw);
    const same = known.filter((d) => deckKey(d) === k);
    if (same.length === 1) return same[0]!;
    const near = k.length >= 3 ? known.filter((d) => deckKey(d).includes(k) || k.includes(deckKey(d))) : [];
    return near.length === 1 ? near[0]! : null;
  };
  // Two decks that would both be "L1" are named in full.
  const all = [...known, ...alsoNamed.filter((d) => !decks.has(d))];
  const shorts = new Map(all.map((d) => [d, deckShort(d)]));
  const clash = (d: string) => all.some((o) => o !== d && shorts.get(o)!.toLowerCase() === shorts.get(d)!.toLowerCase());
  const label = (d: string, page: number) => `${clash(d) ? decodeDeck(d).replace(/\[/g, "(").replace(/\]/g, ")") : shorts.get(d)} p${page}`;

  let repaired = 0, removed = 0, gap = false;
  const rows = markdown.split("\n");
  const { roles } = fenceRoles(rows);
  const lines = rows.flatMap((line, i) => {
    // A line that was only a bad figure leaves one blank line, not two.
    if (gap) { gap = false; if (line.trim() === "" && (rows[i - 2] ?? "").trim() === "") return []; }
    if (roles[i] !== "text" || !line.includes("slide")) return [line];
    let dropped = false;
    const out = outsideCode(line, (part) => part.replace(CITE_RE, (_m, bang: string, text: string, scheme: string, rawDeck: string, n: string) => {
      const deck = resolve(rawDeck.trim());
      const page = Number(n);
      const pages = deck ? decks.get(deck)! : 0;
      if (!deck || page < 1 || (pages > 0 && page > pages)) { removed++; dropped = true; return GONE; }
      if (deck !== rawDeck) repaired++;
      return bang ? `![${text}](${scheme}:${deck}#${page})` : `[${label(deck, page)}](${scheme}:${deck}#${page})`;
    }));
    if (!dropped) return [out];
    const tidy = tidyGone(out);
    // Nothing left but a bullet or a quote mark: the line goes.
    if (tidy.trim() && !/^\s*(?:[-*+]|\d+[.)]|>)\s*$/.test(tidy)) return [tidy];
    gap = true;
    return [];
  });
  return { markdown: lines.join("\n"), repaired, removed };
}

// Lecturers commonly publish a colour deck and a printable one that differ
// only by a "BW" token. They are the same lecture; keep the colour copy, whose
// figures are what the guide embeds.
export function preferColourDeck(names: string[]): string[] {
  const isBw = (n: string) => /[-_]BW[-_.]/i.test(n);
  const key = (n: string) => n.replace(/[-_]BW([-_.])/i, "$1").toLowerCase();
  const bySeries = new Map<string, string[]>();
  for (const n of names) {
    const k = key(n);
    bySeries.set(k, [...(bySeries.get(k) ?? []), n]);
  }
  return [...bySeries.values()].map((group) => group.find((n) => !isBw(n)) ?? group[0]!);
}

// Which of a module's files the guide is written from. Once the categoriser
// has run, the answer is "the PDFs it called slides"; before that — a module
// synced for the first time, or an LLM-less install — a filename pattern
// stands in, so generation is never blocked on classification. Colour decks
// win over their black-and-white twins either way.
const DECK_NAME_RE = /(lect|lecture|week|unit|topic|part|chapter|intro)/i;

export function selectGuideDecks<T extends { displayName: string; category: string | null }>(rows: T[]): T[] {
  const categorised = rows.some((r) => r.category !== null);
  const pdfs = rows
    .filter((r) => /\.pdf$/i.test(r.displayName))
    .filter((r) => (categorised ? r.category === "slides" : DECK_NAME_RE.test(r.displayName)))
    .sort((a, b) => a.displayName.localeCompare(b.displayName, undefined, { numeric: true }));
  const keep = new Set(preferColourDeck(pdfs.map((r) => r.displayName)));
  return pdfs.filter((r) => keep.has(r.displayName));
}
