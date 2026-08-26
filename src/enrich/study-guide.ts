import { z } from "zod";
import { chatJson, chatText, type CompatConfig } from "./openai-compat";

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

// Splits extracted deck text on its "-- N of M --" page markers.
export function slidePages(deckText: string): { page: number; text: string }[] {
  const parts = deckText.split(/--\s*(\d+)\s*of\s*\d+\s*--/);
  const out: { page: number; text: string }[] = [];
  for (let i = 1; i < parts.length; i += 2) {
    out.push({ page: Number(parts[i]), text: (parts[i + 1] ?? "").trim() });
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

const styleSystem = (deckName: string, pageCount: number, figures: number[]) => `You are writing ONE SECTION of a university study guide. The reader will learn from your text ALONE, without the slides in front of them.

Non-negotiable style:
- For every hard idea: an "**Explain like I'm a beginner.**" pass FIRST — plain words and one concrete everyday analogy — then "**The precise mechanics.**" with the real detail, then why it matters.
- Plain academic prose. No emoji. No marketing language. Explain jargon on first use.
- Include real commands, code or output from the slides in fenced blocks and walk through them line by line.
- Recreate structural concepts as mermaid diagrams in \`\`\`mermaid fences. Put a BLANK LINE before the opening fence and after the closing fence. Keep node labels short and free of parentheses and quotes.
- Cite the slide a claim comes from as [slide N](slide:${deckName}#N). The deck text below is marked with "-- N of ${pageCount} --" page markers; use those numbers, and never cite a number above ${pageCount}.
- These slides are mostly picture, so they carry a diagram, screenshot or figure: ${figures.length ? figures.join(", ") : "(none detected)"}. When your section covers one of them, EMBED IT on its own line as ![short caption](slide-img:${deckName}#N). Embed at least one where any of those slides falls in your range — a reader who cannot see the figure cannot follow the point it makes.
- Never invent content that is not in the slides. If the deck is thin on a point, say less rather than filling.
- Start with the "### " heading you are given and write nothing above it. Do not write a chapter title.`;

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
export function normalizeFences(markdown: string): string {
  const lines = markdown.split("\n");
  const out: string[] = [];
  let inFence = false;
  for (const line of lines) {
    const isFence = /^\s*```/.test(line);
    if (isFence && !inFence) {
      if (out.length && out[out.length - 1]!.trim() !== "") out.push("");
      out.push(line);
      inFence = true;
      continue;
    }
    if (isFence && inFence) {
      out.push(line);
      out.push("");
      inFence = false;
      continue;
    }
    // Collapse the doubled blank line a normalised fence can create.
    if (line.trim() === "" && out.length && out[out.length - 1]!.trim() === "") continue;
    out.push(line);
  }
  return out.join("\n");
}

export function createGuideGenerator(cfg: CompatConfig) {
  return {
    async outline(deckName: string, deckText: string, pageCount: number): Promise<GuideOutline | null> {
      const raw = await chatJson(
        cfg, fetch, OUTLINE_SYSTEM,
        `Deck: ${deckName} (${pageCount} slides)\n\n=== DECK TEXT ===\n${deckText}`,
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
      const body = await withRetry(() => chatText(
        cfg,
        styleSystem(deckName, pageCount, figures),
        `Write this section in full depth.

Heading (use it verbatim as your first line): ### ${heading}
What it must teach: ${covers}
It draws mainly on slides ${slides}, but read the whole deck for context.

=== DECK TEXT (${deckName}, ${pageCount} slides) ===
${deckText}`,
        { maxTokens: 8000, temperature: 0.3 },
      ));
      return normalizeFences(body.trim());
    },
  };
}

// Generated markdown goes straight into the reader, so the shapes that break
// it are worth catching before it is stored rather than after.
export function validateChapter(markdown: string, deckName: string, pageCount: number): string[] {
  const problems: string[] = [];

  const fences = (markdown.match(/^```/gm) ?? []).length;
  if (fences % 2 !== 0) problems.push(`unbalanced code fences (${fences})`);

  // A closing fence pressed against prose swallows everything after it.
  // Checked line by line: the previous regex matched the shortest span ending
  // in a fence NOT followed by a newline, which happily matched the final
  // fence of the document (followed by nothing) and reported a problem on
  // every clean chapter.
  const lines = markdown.split("\n");
  let open = false;
  for (const [i, line] of lines.entries()) {
    if (!/^\s*```/.test(line)) continue;
    if (!open) { open = true; continue; }
    open = false;
    const next = lines[i + 1];
    if (next !== undefined && next.trim() !== "") problems.push(`fence at line ${i + 1} is not followed by a blank line`);
  }

  const cited = [...markdown.matchAll(new RegExp(`slide(?:-img)?:${deckName}#(\\d+)`, "g"))].map((m) => Number(m[1]));
  const bad = cited.filter((n) => n < 1 || n > pageCount);
  if (bad.length) problems.push(`${bad.length} citation(s) outside 1..${pageCount}: ${[...new Set(bad)].join(", ")}`);
  if (cited.length === 0) problems.push("no slide citations at all");

  const wrongDeck = [...markdown.matchAll(/slide(?:-img)?:([A-Za-z0-9._-]+)#/g)]
    .map((m) => m[1]).filter((d) => d !== deckName);
  if (wrongDeck.length) problems.push(`citations to unknown deck(s): ${[...new Set(wrongDeck)].join(", ")}`);

  return problems;
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
