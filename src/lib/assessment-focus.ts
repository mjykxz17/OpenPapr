// Slide decks bury the assessment breakdown near the end, past any head
// slice a prompt budget allows. When the text exceeds the cap, keep only
// windows of lines around assessment-looking content instead of the head.
const ASSESSMENT_LINE_RE = /(\d+\s*%|assess|weight|grading|graded|marks|exam|quiz|midterm)/i;
const CONTEXT_LINES = 5;

export function focusAssessmentText(text: string, cap = 18_000): string {
  if (text.length <= cap) return text;
  const lines = text.split("\n");
  const keep = new Set<number>();
  for (let i = 0; i < lines.length; i++) {
    if (!ASSESSMENT_LINE_RE.test(lines[i])) continue;
    for (let j = Math.max(0, i - CONTEXT_LINES); j <= Math.min(lines.length - 1, i + CONTEXT_LINES); j++)
      keep.add(j);
  }
  if (keep.size === 0) return text.slice(0, cap);
  const parts: string[] = [];
  let prev = -2;
  for (const i of [...keep].sort((a, b) => a - b)) {
    if (i !== prev + 1) parts.push("…");
    parts.push(lines[i]);
    prev = i;
  }
  return parts.join("\n").slice(0, cap);
}
