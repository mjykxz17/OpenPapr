import { queryTokens, type Hit } from "./retrieve";

// Turning retrieved passages into numbered sources for the model, and the
// model's [n] citations back into links the student can open.

// What a source is, in the words shown next to it. The study guide is
// OpenPapr's own summary of the slides, so it is never passed off as one.
export type SourceLabel = "slides" | "study guide" | "your note" | "announcement";
const LABEL: Record<Hit["kind"], SourceLabel> = { slide: "slides", guide: "study guide", note: "your note", announcement: "announcement" };
export const sourceLabel = (kind: Hit["kind"]): SourceLabel => LABEL[kind];

export type SourceRef = {
  n: number; kind: Hit["kind"]; label: SourceLabel; title: string; code: string; moduleId: number; href: string;
  slide: { deck: string; page: number } | null;
};

export const SOURCES_RULES = `SOURCES are passages from the student's own slides, notes and course announcements, and from the study guide OpenPapr wrote from the slides, numbered [1], [2], …
- For questions about course content, answer from SOURCES. Put the source number in square brackets right after the sentence it supports, like "A canary sits before the return address [2]." Cite only numbers that are listed.
- A source marked (study guide) is a summary, not the lecturer's words: when a slide says the same thing, cite the slide.
- If SOURCES and FACTS don't cover the question, say that their material doesn't seem to cover it, and suggest where to look. Never fill gaps from general knowledge without saying so.
- For a content question you may use up to 6 short sentences or a short list.`;

export function sourcesBlock(hits: Hit[]): string {
  return hits.map((h, i) => `[${i + 1}] (${sourceLabel(h.kind)}) ${h.code ? `${h.code} · ` : ""}${h.title}\n${h.body.replace(/\s+/g, " ").slice(0, 1200)}`).join("\n\n");
}

// Guide passages are titled "Guide: …" in the index; the student sees "Study guide: …".
const shownTitle = (h: Pick<Hit, "kind" | "title">) => (h.kind === "guide" ? h.title.replace(/^Guide:\s*/, "Study guide: ") : h.title);

export function sourceHref(h: Pick<Hit, "kind" | "moduleId" | "deck" | "page" | "anchor" | "itemId">): string {
  const m = `/modules/${h.moduleId}`;
  if ((h.kind === "slide" || h.kind === "note") && h.deck && h.page) return `${m}/guide?slide=${encodeURIComponent(h.deck)}&page=${h.page}`;
  if (h.kind === "guide" && h.anchor) return `${m}/guide#${h.anchor}`;
  if (h.kind === "announcement" && h.itemId) return `${m}#a-${h.itemId}`;
  return m;
}

// The sources the answer actually cites, in the order they were numbered.
// Citations to numbers that were never given are dropped from the text.
// `grounded` is false when no valid citation is left: an answer that cites
// none of its sources is the model talking, and the chat can say so.
export function citedSources(reply: string, hits: Hit[]): { text: string; sources: SourceRef[]; grounded: boolean } {
  const used = new Set<number>();
  const text = reply.replace(/\[(\d+(?:\s*[,–-]\s*\d+)*)\]/g, (whole, inner: string) => {
    const nums = inner.split(/\s*,\s*/).flatMap((part) => {
      const r = /^(\d+)\s*[–-]\s*(\d+)$/.exec(part);
      if (r) { const a = Number(r[1]), b = Number(r[2]); return b >= a && b - a < 10 ? Array.from({ length: b - a + 1 }, (_, i) => a + i) : []; }
      return [Number(part)];
    }).filter((n) => n >= 1 && n <= hits.length);
    if (!nums.length) return "";
    nums.forEach((n) => used.add(n));
    return nums.map((n) => `[${n}]`).join("");
  }).replace(/\s+([.,;:])/g, "$1");
  const sources = [...used].sort((a, b) => a - b).map((n) => {
    const h = hits[n - 1]!;
    return { n, kind: h.kind, label: sourceLabel(h.kind), title: shownTitle(h), code: h.code, moduleId: h.moduleId, href: sourceHref(h), slide: (h.kind === "slide" || h.kind === "note") && h.deck && h.page ? { deck: h.deck, page: h.page } : null };
  });
  return { text, sources, grounded: sources.length > 0 };
}

// --- follow-ups and history ---------------------------------------------------------

// Takes the [n] markers out of an earlier answer. They pointed at that turn's
// sources; left in, the model reads them as this turn's numbers.
export const stripCitations = (text: string) =>
  text.replace(/\s*\[\d+(?:\s*[,–-]\s*\d+)*\]/g, "").replace(/\s+([.,;:!?])/g, "$1");

export type Turn = { role: "user" | "assistant"; content: string };
export const historyForModel = (turns: Turn[]): Turn[] =>
  turns.map((m) => ({ role: m.role, content: m.role === "assistant" ? stripCitations(m.content) : m.content }));

// "why?", "and heap spraying?", "give an example of that": short, and leaning
// on the question before it.
const LEANS = /^(and|but|so|also|then|why|how come|what about|how about|what if|ok|okay|wait|more|another)\b|\b(it|its|that|this|those|these|they|them)\b/i;
export function isFollowUp(question: string): boolean {
  const words = question.trim().split(/\s+/).filter(Boolean);
  if (!words.length || words.length > 8) return false;
  return queryTokens(question).length <= 1 || LEANS.test(question.trim());
}
export const previousQuestion = (turns: Turn[]): string | null => [...turns].reverse().find((m) => m.role === "user")?.content ?? null;

// Questions about what the course teaches, as opposed to dates, logistics and
// chat. Only these get "not in your material" when nothing matches; the rest
// still go to the model with the student's facts.
const LOGISTICS = /\b(due|deadlines?|submit\w*|submission|missing|overdue|late|when|today|tonight|tomorrow|week|weekend|schedule|timetable|announce\w*|said|say|lecturers?|prof\w*|tutors?|ta|weight\w*|worth|grades?|marks?|remind\w*|tasks?|plan|quiz\w*|exams?|mid-?terms?|finals?|tests?|assignments?|labs?|projects?|tutorials?|homework|venue|cover\w*)\b/i;
const CHAT = /^(hi|hey|hello|yo|thanks?|thank you|ty|ok(ay)?|cool|nice|lol|bye|good (morning|night|evening)|who are you|how are you)\b/i;
export function isContentQuestion(question: string): boolean {
  const q = question.trim();
  if (LOGISTICS.test(q) || CHAT.test(q)) return false;
  return queryTokens(q).length > 0;
}

// --- answering ----------------------------------------------------------------------

export const NOT_FOUND = "I couldn't find that in your material. Try other words, or open the slides from the module page.";

export type Answer = { reply: string; sources: SourceRef[]; grounded: boolean; askedModel: boolean };
type Llm = (messages: { role: "system" | "user" | "assistant"; content: string }[], opts: { maxTokens: number; temperature: number }) => Promise<string>;

// One answer from the student's material. A content question with no passage
// over the relevance floor gets "not in your material" and the model is never
// asked, so it cannot fill the gap from what it happens to know. `context` is
// the previous question when this one is a follow-up. `reply` is empty when
// the model said nothing usable.
export async function answerFromMaterial(input: {
  question: string; earlier: Turn[]; hits: Hit[]; system: string; facts: string; context?: string | null; llm: Llm;
}): Promise<Answer> {
  const { question, hits } = input;
  const content = isContentQuestion(question) || (!!input.context && isContentQuestion(input.context));
  if (!hits.length && content) return { reply: NOT_FOUND, sources: [], grounded: false, askedModel: false };
  const system = hits.length
    ? `${input.system}\n\n${SOURCES_RULES}\n\nFACTS\n${input.facts}\n\nSOURCES\n${sourcesBlock(hits)}`
    : `${input.system}\n\nFACTS\n${input.facts}`;
  const out = await input.llm([
    { role: "system", content: system },
    ...historyForModel(input.earlier.slice(-8)),
    { role: "user", content: question },
  ], { maxTokens: hits.length ? 700 : 400, temperature: hits.length ? 0.3 : 0.6 });
  const clean = out.replace(/<think>[\s\S]*?<\/think>/g, "").replace(/\*\*(.+?)\*\*/g, "$1").replace(/^#+\s*/gm, "").trim();
  const cited = citedSources(clean, hits);
  return { reply: cited.text, sources: cited.sources, grounded: cited.grounded, askedModel: true };
}
