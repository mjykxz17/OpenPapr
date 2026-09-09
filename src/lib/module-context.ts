// The module context document: one markdown page per module that says what
// the module is, how it is assessed, which decks it has, how the lecturer
// teaches and what the student wants the writer to keep in mind. It is put
// in front of the model on every call that writes for the module, so a
// section about pointers is written knowing it sits in week 3 of a security
// module whose lecturer grades on a practical, not as an anonymous deck.
//
// Assembled fresh from the database each time rather than stored, so the
// facts never go stale; only the two prose parts (the model's profile and the
// student's notes) persist. Pure: takes rows, returns text.

export interface ModuleContextInput {
  code: string;
  name: string;
  term: string | null;
  components: { name: string; weightPct: number | null; source: string }[];
  decks: string[];
  profile: string | null;
  notes: string | null;
}

// Headings the notes editor starts from. Empty sections are dropped when the
// document is rendered, so leaving one blank costs nothing.
export const NOTES_TEMPLATE = `## About this module
(What the module is really about, in your words. Prerequisites it assumes.)

## Lecturer and teaching style
(How lectures run. Do they teach from examples or from definitions? Live demos? What do they keep repeating?)

## Assessment and exam format
(Open or closed book, question style, what past papers looked like, what was said in class about the exam.)

## What to emphasise
(Topics the lecturer flagged as important, things classmates struggle with, what you personally want the guide to go deep on.)

## Terminology and conventions
(Notation, naming, tools and versions the module uses, so the guide matches the slides.)
`;

// Strips sections whose only content is the template's parenthetical hint,
// so an untouched scaffold contributes nothing to the prompt.
export function meaningfulNotes(notes: string | null): string | null {
  if (!notes) return null;
  const sections = notes.split(/^(?=## )/m);
  const kept = sections.filter((s) => {
    const body = s.replace(/^## .*$/m, "").trim();
    return body.length > 0 && !/^\([\s\S]*\)$/.test(body);
  });
  const out = kept.join("").trim();
  return out.length ? out : null;
}

const cleanTitle = (code: string, name: string) =>
  name.replace(new RegExp(`^${code.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}\\b[\\s:—-]*`), "")
    .replace(/\s*\[\d+\]\s*$/, "").trim() || name;

const SOURCE_NOTE: Record<string, string> = {
  canvas_api: "from Canvas",
  llm_syllabus: "read from the syllabus",
  manual: "entered by the student",
};

export function renderModuleContext(input: ModuleContextInput): string {
  const parts: string[] = [];
  const title = cleanTitle(input.code, input.name);
  parts.push(`# ${input.code} ${title}`.trim() + (input.term ? `\nTerm: ${input.term}` : ""));

  const weighted = input.components.filter((c) => c.weightPct != null);
  if (weighted.length) {
    const rows = weighted
      .sort((a, b) => (b.weightPct ?? 0) - (a.weightPct ?? 0))
      .map((c) => `- ${c.name}: ${c.weightPct}% (${SOURCE_NOTE[c.source] ?? c.source})`);
    parts.push(`## Assessment\n${rows.join("\n")}`);
  }

  if (input.decks.length) {
    parts.push(`## Lecture decks, in order\n${input.decks.map((d, i) => `${i + 1}. ${d}`).join("\n")}`);
  }

  if (input.profile?.trim()) {
    parts.push(`## The module and its lecturer, as observed from the decks\n${input.profile.trim()}`);
  }

  const notes = meaningfulNotes(input.notes);
  if (notes) parts.push(`## Notes from the student\n${notes}`);

  return parts.join("\n\n") + "\n";
}

// Wraps the rendered document for a system prompt, with the one instruction
// that matters: it is background, not a slide, so it is never cited.
export function contextPromptBlock(context: string | null | undefined): string {
  if (!context?.trim()) return "";
  return `\n\n=== MODULE CONTEXT ===\n${context.trim()}\n=== END MODULE CONTEXT ===\n` +
    `Use the module context to place this deck within the module, keep the lecturer's terminology and notation, ` +
    `match how the lecturer explains things, and give weight to what is assessed. It is background, not a slide: never cite it and never attribute claims to it.`;
}
