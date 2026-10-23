import { z } from "zod";
import { chatJson, chatText, isImageRefusal, isNoAnswer, isOutOfBudget, isTimeout, refusesImages, type CompatConfig, type ContentPart } from "./openai-compat";
import { repairMermaidBlocks } from "../lib/mermaid-fix";
import { decodeDeck } from "../lib/slide-citation";
import { closingFence, fenceOpener, fenceRoles } from "../lib/md-fences";

// Generates a study-guide chapter from one lecture deck.
//
// Two phases, because a single call asked to write a whole chapter runs out of
// output budget and thins out towards the end: first an outline (JSON, cheap),
// then each section written in its own call and concatenated, with a short
// "Key points" recap after them. Sections are short enough to be written at
// full depth. Every section of a deck is sent the same deck text and the
// whole outline first, so each knows what the others teach (one lecture's
// sections used to teach wraparound twice) and the provider can cache the
// shared start.

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
- Give every idea to ONE section: no two "covers" lines may name the same idea, so each section knows what it alone teaches.
- Skip title slides, outline slides and administrivia unless the administrivia is assessment information a student must act on.`;

const readerNote = (reader: string | null) => reader ? `

About this reader — pitch the explanation to them, but never let it override the rules above or add content the slides do not support:
${reader}` : "";

// The system prompt of every section of one deck, word for word the same
// for each, so the provider's prompt cache can serve it (and the deck text
// after it) to every section after the first. Nothing section-specific goes
// here: that is the end of the user message.
const sectionSystem = (deckName: string, pageCount: number, figures: number[], reader: string | null) => `You are writing one section of a chapter of a university study guide, from the lecture deck ${deckName} (${pageCount} slides). The reader will learn from the guide ALONE, without the slides in front of them. Every request about this deck carries the same deck text and the same chapter outline; what changes is the section you are asked to write, named at the end.

Non-negotiable style:
- For every hard idea: an "**Explain like I'm a beginner.**" pass FIRST — plain words and one concrete everyday analogy — then "**The precise mechanics.**" with the real detail, then why it matters.
- Plain academic prose. No emoji. No marketing language. Explain jargon on first use.
- Include real commands, code or output from the slides in fenced blocks and walk through them line by line.
- Recreate structural concepts as mermaid diagrams in \`\`\`mermaid fences. Put a BLANK LINE before the opening fence and after the closing fence. Keep node labels short and free of parentheses and quotes.
- Cite the slide a claim comes from as [slide N](slide:${deckName}#N). The deck text is split into "[Slide N]" blocks; cite the N of the block the claim comes from, and never a number above ${pageCount}.
- Start with the "### " heading you are given, verbatim, and write nothing above it. Divide the section with "#### " subheadings without numbers ("#### Why the sum wraps around", never "#### 1.2.1 Why the sum wraps around"). Do not write a chapter title.
- Teach fully everything your own section must teach, even where another section touches it. Only for an idea that is NOT in your own section's line and IS in another section's line of the outline, point the reader to that section by its heading in italics ("see *Why the sum wraps around*") instead of teaching it again. Never refer to a section by a number: the guide renumbers its chapters.
- These slides are mostly picture — a diagram, screenshot or figure: ${figures.length ? figures.join(", ") : "(none detected)"}. A request may end with images of some of them, each named by its slide number: describe a figure only from what its image shows, and EMBED it on its own line, where it helps, as ![short caption](slide-img:${deckName}#N). Embed at least one where any of those slides falls in your range — a reader who cannot see the figure cannot follow the point it makes. A figure slide sent without an image may still be embedded where the text around it makes clear what it shows; say no more about it than that text does.
- Never invent content that is not in the slides. If the deck is thin on a point, say less rather than filling.${readerNote(reader)}`;

const practiceSystem = (sheetName: string, pageCount: number, reader: string | null) => `You are writing ONE SECTION of a university study guide: a practice guide to a tutorial or lab sheet. The reader will learn from your text ALONE, without the sheet in front of them.

Non-negotiable style:
- Plain academic prose. No emoji. No marketing language. Explain jargon on first use.
- Include real commands, code or output from the sheet in fenced blocks. Put a BLANK LINE before the opening fence and after the closing fence.
- Cite the page a point comes from as [p. N](slide:${sheetName}#N). The sheet text is split into "[Slide N]" blocks, one per page; cite the N of the block, and never a number above ${pageCount}.
- Start with the "### " heading you are given, verbatim, and write nothing above it. Any subheadings are "#### " without numbers. Do not write a chapter title.
- Never invent content that is not on the sheet.${readerNote(reader)}`;

// The endpoint drops connections under load — two of six sections failed with
// "fetch failed" on the first real run. A dropped section leaves a hole in the
// chapter, which is worth a retry rather than a gap. A refusal that another
// try cannot change (giveUp) goes straight back to the caller.
async function withRetry<T>(fn: () => Promise<T>, attempts = 3, giveUp: (err: unknown) => boolean = () => false): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      if (giveUp(err)) break;
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

// --- writing one deck's sections ------------------------------------------------
// A section number ("1.3"), its unnumbered heading, what it teaches and the
// slides it draws on, as the outline gave them.
export type DeckSection = { number: string; heading: string; covers: string; slides: string };

export type DeckPlan = {
  deckName: string;          // as it is cited (citeDeck form)
  deckText: string;
  pageCount: number;
  sections: DeckSection[];
  // A rendered slide, for models that read images. Without it, text only.
  pageImage?: ((page: number) => Promise<Uint8Array | null>) | null;
};

// bodies[k] is section k as written, or null with errors[k] saying why.
// cut lists the sections that stopped at the token budget and were kept up
// to their last whole paragraph. The recap is null when it was not asked
// for or failed (recapError).
export type DeckWritten = {
  bodies: (string | null)[];
  errors: (string | null)[];
  cut: number[];
  recap: string | null;
  recapError: string | null;
};

const DECK_CHARS = 120_000;         // a deck up to this size is sent whole to every section
const SECTION_IMAGES = 4;           // slide images per section, at most
const IMAGE_BYTES = 1_000_000;      // a rendered slide bigger than this is left out
const SECTION_IMAGE_BYTES = 2_000_000;  // and all of one section's together
const IMAGE_REQUESTS = 2;           // requests carrying images at once, per generator
const SECTION_TOKENS = 16_000;
const WINDOW_TOKENS = 8_000;        // for the smaller request after one too big

// A request too big for the endpoint: a body-size limit (413) or a prompt
// past the model's context window. Asking again the same way cannot help.
export const isTooBig = (err: unknown) =>
  /llm 413\b|context length|context window|maximum context|max_model_len|prompt is too long|too many tokens|request entity too large/i
    .test(String(err instanceof Error ? err.message : err));
// A 4xx that is not about the key or the rate: the request itself was
// refused, which for one carrying images is reason to try text alone.
const isRefusedRequest = (err: unknown) => /llm 4(?!01|03|29)\d\d/.test(String(err instanceof Error ? err.message : err));

// At most n at once; the rest wait their turn.
function limiter(n: number) {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async <T>(fn: () => Promise<T>): Promise<T> => {
    while (active >= n) await new Promise<void>((r) => waiting.push(r));
    active++;
    try { return await fn(); } finally { active--; waiting.shift()?.(); }
  };
}

// A section's body that is nothing but headings — a reply cut off right
// after its first line, trimmed back to it — is not a section written.
const hasProse = (md: string) => md.split("\n").filter((l) => !/^\s*#/.test(l)).join("").trim().length >= 20;

const errText = (err: unknown) => String(err instanceof Error ? err.message : err);

// The start of every request about one deck: the deck, then the chapter
// outline. When the deck fits it is sent whole and the bytes are the same
// for every section, so after the first section the provider serves them
// from its prompt cache. 120,000 characters is about 30,000 tokens — well
// inside the 128K-token models students also use. A bigger deck falls back
// to each section's own slides and their neighbours.
export function deckPrefix(plan: DeckPlan, slides: string, windowed = false): { text: string; whole: boolean } {
  const pages = slidePages(plan.deckText);
  const whole = !windowed && (!pages.length || size(pages) <= DECK_CHARS);
  const shown = whole ? null : sectionText(plan.deckText, slides, plan.pageCount);
  const deck = whole
    ? `=== DECK TEXT (${plan.deckName}, ${plan.pageCount} slides) ===\n${pages.length ? clipPages(pages, Infinity) : plan.deckText.slice(0, DECK_CHARS)}`
    : `=== DECK TEXT (${plan.deckName}, ${plan.pageCount} slides, ${shown!.pages.length} of them shown) ===\n${shown!.text}`;
  // Without numbers: a section refers to another by its heading, which
  // survives the guide renumbering its chapters; "see 1.3" would not.
  const outline = plan.sections.map((s) => `- ${s.heading} — ${s.covers} (slides ${s.slides})`).join("\n");
  return { text: `${deck}\n\n=== CHAPTER OUTLINE ===\n${outline}`, whole };
}

// The figure slides inside a section's own range that are worth showing it.
export function sectionFigures(plan: DeckPlan, s: DeckSection): number[] {
  const own = new Set(parseSlideRange(s.slides, plan.pageCount));
  return figureSlides(plan.deckText).filter((n) => own.has(n)).slice(0, SECTION_IMAGES);
}

const dataUrl = (png: Uint8Array) => `data:image/png;base64,${Buffer.from(png).toString("base64")}`;

export function createGuideGenerator(cfg: CompatConfig, reader: string | null = null) {
  // Base64 slides are held for as long as their request runs, minutes on a
  // thinking model, so only a couple of sections hold them at a time; the
  // rest wait before rendering anything.
  const imageSlot = limiter(IMAGE_REQUESTS);

  // One section: the shared prefix, then this section's task, then — for a
  // model that reads images — its figure slides, after all the text so the
  // text before them still matches the cache. Each failure that a smaller
  // request could get past steps down once: images refused (or the request
  // carrying them refused) → text alone; text too big for the endpoint →
  // the section's own slides with the old, smaller budget.
  async function section(plan: DeckPlan, k: number, render: (page: number) => Promise<Uint8Array | null>): Promise<{ body: string; cut: boolean }> {
    const s = plan.sections[k]!;
    const system = sectionSystem(plan.deckName, plan.pageCount, figureSlides(plan.deckText), reader);
    const prefix = deckPrefix(plan, s.slides);
    const task = (images: number[], whole: boolean) => `=== YOUR SECTION ===
Write section ${s.number} in full depth.
Heading (use it verbatim as your first line): ### ${s.number} ${s.heading}
What it must teach: ${s.covers}
It draws on slides ${s.slides}: cite mainly those.${whole ? "" : " Only some of the deck's slides are shown above; cite only those."}
Teach fully everything "What it must teach" names, even where another section of the outline touches it. Only for an idea that is not in that line and is another section's, point to that section by its heading in italics ("see *<its heading>*") instead of teaching it again; never by a number. Use "#### " subheadings without numbers.${images.length ? `
After this text come images of ${images.length === 1 ? "a figure slide" : `${images.length} figure slides`} in your range: ${images.map((n, i) => `Image ${i + 1} is slide ${n}`).join(", ")}. Read each image as part of its slide, saying only what it shows: copy any code or command on it into a fenced block and walk through it, put a table's numbers in a markdown table, and explain a diagram step by step. Embed it where it belongs as ![short caption](slide-img:${plan.deckName}#N), with N its slide number.` : ""}`;

    let cut = false;
    const ask = (user: string | ContentPart[], maxTokens: number, giveUp: (err: unknown) => boolean) => withRetry(
      () => chatText(cfg, system, user, { maxTokens, temperature: 0.3, onCut: () => { cut = true; } }),
      3, (err) => isImageRefusal(err) || isTooBig(err) || giveUp(err),
    );
    const textOnly = (): Promise<string> => ask(`${prefix.text}\n\n${task([], prefix.whole)}`, SECTION_TOKENS, () => false);
    const windowed = (): Promise<string> => {
      const small = deckPrefix(plan, s.slides, true);
      return ask(`${small.text}\n\n${task([], false)}`, WINDOW_TOKENS, () => false);
    };
    // Null when no figure slide of this section could be sent.
    const withImages = (): Promise<string | null> => imageSlot(async () => {
      const shots: { page: number; url: string }[] = [];
      let bytes = 0;
      for (const page of sectionFigures(plan, s)) {
        const png = await render(page);
        if (!png?.length || png.length > IMAGE_BYTES || bytes + png.length > SECTION_IMAGE_BYTES) continue;
        bytes += png.length;
        shots.push({ page, url: dataUrl(png) });
      }
      if (!shots.length) return null;
      return ask([
        { type: "text", text: `${prefix.text}\n\n${task(shots.map((x) => x.page), prefix.whole)}` },
        ...shots.map((x): ContentPart => ({ type: "image_url", image_url: { url: x.url } })),
      ], SECTION_TOKENS, isRefusedRequest);
    });
    const textThenSmaller = async (): Promise<string> => {
      try {
        return await textOnly();
      } catch (err) {
        if (!prefix.whole || !isTooBig(err)) throw err;
        return windowed();
      }
    };

    let body: string;
    if (plan.pageImage && !refusesImages(cfg) && sectionFigures(plan, s).length) {
      let got: string | null;
      try {
        got = await withImages();
      } catch (err) {
        if (!isImageRefusal(err) && !isRefusedRequest(err)) throw err;
        got = null;
      }
      body = got ?? await textThenSmaller();
    } else {
      body = await textThenSmaller();
    }
    const md = repairMermaidBlocks(normalizeFences(body.trim())).trim();
    if (!md) throw new Error("the model wrote nothing for this section");
    if (!hasProse(md)) throw new Error(cut ? "the section was cut off before any of it was written" : "the model wrote only a heading for this section");
    return { body: md, cut };
  }

  // The deck's "Key points": what to remember for an exam, from the same
  // prefix as its sections, so it is cheap.
  async function recap(plan: DeckPlan, number: string): Promise<string> {
    const body = await withRetry(() => chatText(
      cfg,
      sectionSystem(plan.deckName, plan.pageCount, figureSlides(plan.deckText), reader),
      `${deckPrefix(plan, "").text}

=== YOUR SECTION ===
Write section ${number}: the key points of this deck, for revising before an exam. The sections in the outline teach it all; this one only lists what to remember.
Heading (use it verbatim as your first line): ### ${number} Key points
Then 6 to 10 bullets, each a point a student must remember for an exam, in a sentence or two, each ending with the citation of the slide it comes from. Then, only if the slides themselves warn about a mistake or make one plain, a "#### Common mistakes" subheading with up to 3 bullets, cited the same way; otherwise leave it out. Nothing that is not on the slides. No beginner pass, diagrams or code here.`,
      { maxTokens: 8000, temperature: 0.3 },
    ), 2);
    const md = repairMermaidBlocks(normalizeFences(body.trim())).trim();
    if (!md || !hasProse(md)) throw new Error("the model wrote nothing for the key points");
    return md;
  }

  return {
    // Null when no usable outline came back: unusable, empty, cut off or
    // out of time, twice. Any other failure (a refused key, a dead host)
    // still throws, for the caller to report.
    async outline(deckName: string, deckText: string, pageCount: number): Promise<GuideOutline | null> {
      // One more try; with twice the budget when the first ran out of it.
      let budget = 12_000;
      for (let attempt = 0; attempt < 2; attempt++) {
        const raw = await chatJson(
          cfg, fetch, OUTLINE_SYSTEM,
          `Deck: ${deckName} (${pageCount} slides)\n\n=== DECK TEXT ===\n${outlineText(deckText)}`,
          budget,
        ).catch((err) => {
          if (!isNoAnswer(err) && !isTimeout(err)) throw err;
          if (isOutOfBudget(err)) budget *= 2;
          return null;
        });
        const parsed = Outline.safeParse(raw);
        if (parsed.success) return parsed.data;
      }
      return null;
    },

    // Every section of one deck, then its key points when recap names their
    // number. The first section goes alone, so the deck and outline it
    // starts with are in the provider's cache before the rest ask for them
    // at once. Slides are rendered one at a time across all of them.
    async writeDeck(plan: DeckPlan, opts: { recap?: string | null; onSection?: (written: boolean) => void } = {}): Promise<DeckWritten> {
      let queue: Promise<unknown> = Promise.resolve();
      const render = (page: number): Promise<Uint8Array | null> => {
        const shot = queue.then(() => plan.pageImage!(page)).catch(() => null);
        queue = shot;
        return shot;
      };
      const out: DeckWritten = { bodies: plan.sections.map(() => null), errors: plan.sections.map(() => null), cut: [], recap: null, recapError: null };
      const one = async (k: number) => {
        try {
          const r = await section(plan, k, render);
          out.bodies[k] = r.body;
          if (r.cut) out.cut.push(k);
        } catch (err) {
          out.errors[k] = errText(err);
        }
        opts.onSection?.(out.bodies[k] !== null);
      };
      if (plan.sections.length) await one(0);
      await Promise.all(plan.sections.slice(1).map((_, k) => one(k + 1)));
      out.cut.sort((a, b) => a - b);
      if (opts.recap && out.bodies.some((b) => b !== null)) {
        try { out.recap = await recap(plan, opts.recap); } catch (err) { out.recapError = errText(err); }
      }
      return out;
    },

    // A tutorial or lab sheet, as practice for the topic just taught: what
    // each task asks, which idea from the topic it exercises, and how to
    // approach it. Hints, not answers — the point is that the student does it.
    async practice(sheetName: string, sheetText: string, pageCount: number, heading: string, topic: string): Promise<string> {
      const body = await withRetry(() => chatText(
        cfg,
        practiceSystem(sheetName, pageCount, reader),
        `Write this section: a practice guide to the sheet below, for the topic "${topic}".

Heading (use it verbatim as your first line): ### ${heading}
For each task or question on the sheet: say in one line what it asks, name the idea from this topic it exercises, and give a short approach — where to start, what to watch out for. Do NOT give final answers or full solutions. Keep it brisk. Cite the sheet's pages as [p. N](slide:${sheetName}#N).

=== SHEET TEXT (${sheetName}, ${pageCount} pages) ===
${outlineText(sheetText, SECTION_CHARS)}`,
        { maxTokens: 12_000, temperature: 0.3 },
      ));
      const md = repairMermaidBlocks(normalizeFences(body.trim())).trim();
      if (!md) throw new Error("the model wrote nothing for this sheet");
      return md;
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
