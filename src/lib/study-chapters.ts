// Splits a study-guide markdown document into a persistent preamble (the H1
// title and any intro before the first chapter) plus one entry per level-2
// (`## `) chapter, so the reader can render chapters as tabs. Chapter headings
// are assumed not to appear inside fenced code blocks (the guides don't do
// that).
export type GuideChapter = { label: string; markdown: string };

export function splitGuideIntoChapters(markdown: string): { preamble: string; chapters: GuideChapter[] } {
  const lines = markdown.split("\n");
  const starts: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^## (?!#)/.test(lines[i])) starts.push(i);
  }
  if (starts.length === 0) return { preamble: markdown, chapters: [] };

  const preamble = lines.slice(0, starts[0]).join("\n").trim();
  const chapters: GuideChapter[] = starts.map((start, idx) => {
    const end = idx + 1 < starts.length ? starts[idx + 1] : lines.length;
    const body = lines.slice(start, end).join("\n").trim();
    return { label: chapterLabel(lines[start]), markdown: body };
  });
  return { preamble, chapters };
}

// A short tab label from a `## ` heading: keep the leading number, drop a
// trailing parenthetical and anything after a colon.
export function chapterLabel(headingLine: string): string {
  return headingLine
    .replace(/^#+\s*/, "")
    .replace(/\s*\(.*$/, "")
    .split(":")[0]
    .trim();
}

// Anchor id for a heading; must match the id the renderer stamps on the same
// heading text so outline links resolve.
export function slugifyHeading(text: string): string {
  return text.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export type Subheading = { label: string; slug: string };

// The `### ` subsections of a chapter, for the outline sidebar. Headings inside
// fenced code blocks are ignored.
export function extractSubheadings(markdown: string): Subheading[] {
  const out: Subheading[] = [];
  let inFence = false;
  for (const line of markdown.split("\n")) {
    if (/^```/.test(line)) { inFence = !inFence; continue; }
    if (inFence) continue;
    const m = /^### (?!#)(.+)$/.exec(line);
    if (m) out.push({ label: m[1].trim(), slug: slugifyHeading(m[1].trim()) });
  }
  return out;
}
