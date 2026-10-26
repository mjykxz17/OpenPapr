import { queryTokens, tokens, type Hit } from "./retrieve";

// Turning retrieved passages into numbered sources for the model, and the
// model's [n] citations back into links the student can open.

// What a source is, in the words shown next to it. The study guide is
// OpenPapr's own summary of the slides, so it is never passed off as one.
export type SourceLabel = "slides" | "study guide" | "your note" | "announcement" | "assignment" | "course page" | "message";
const LABEL: Record<Hit["kind"], SourceLabel> = { slide: "slides", guide: "study guide", note: "your note", announcement: "announcement", assignment: "assignment", page: "course page", message: "message" };
export const sourceLabel = (kind: Hit["kind"]): SourceLabel => LABEL[kind];

export type SourceRef = {
  n: number; kind: Hit["kind"]; label: SourceLabel; title: string; code: string; moduleId: number; href: string;
  slide: { deck: string; page: number } | null;
};

export const SOURCES_RULES = `SOURCES are passages from the student's own slides, notes, course announcements, assignment and course pages, lecturers' messages, and from the study guide OpenPapr wrote from the slides, numbered [1], [2], …
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
// sources; left in, the model reads them as this turn's numbers. A bracket
// straight after a name or another bracket is code ("arr[0]", "m[1][2]"), not
// a citation, and stays.
export const stripCitations = (text: string) =>
  text.replace(/\s*(?<![\w\])])(?:\[\d+(?:\s*[,–-]\s*\d+)*\])+/g, "");

export type Turn = { role: "user" | "assistant"; content: string };
export const historyForModel = (turns: Turn[]): Turn[] =>
  turns.map((m) => ({ role: m.role, content: m.role === "assistant" ? stripCitations(m.content) : m.content }));

// "why?", "and heap spraying?", "give an example of that": short, and leaning
// on the question before it. Being short is not enough: "what is a heap?" is
// a new question, so it needs a leaning word or no subject of its own.
const LEANS = /^(and|but|so|also|then|why|how come|what about|how about|what if|ok|okay|wait|more|another)\b|\b(it|its|that|this|those|these|they|them)\b/i;
export function isFollowUp(question: string): boolean {
  const words = question.trim().split(/\s+/).filter(Boolean);
  if (!words.length || words.length > 8) return false;
  return queryTokens(question).length === 0 || LEANS.test(question.trim());
}
export const previousQuestion = (turns: Turn[]): string | null => [...turns].reverse().find((m) => m.role === "user")?.content ?? null;

// The conversation so far as the browser sent it, for a chat that is not
// stored (the shared demo's): the last few turns, each cut to a sane length.
// It only ever shapes the sender's own answer, so it is taken as given.
export const SENT_TURNS = 8;
export function sentTurns(raw: unknown): Turn[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(-SENT_TURNS).flatMap((t): Turn[] => {
    const m = t as { role?: unknown; content?: unknown } | null;
    if ((m?.role !== "user" && m?.role !== "assistant") || typeof m.content !== "string" || !m.content.trim()) return [];
    return [{ role: m.role, content: m.content.slice(0, 2000) }];
  });
}

// Questions about what the course teaches, as opposed to dates, logistics and
// chat. Only these get "not in your material" when nothing matches; the rest
// still go to the model with the student's facts. A question is logistics
// only when every word in it is: "when is the next quiz?" is, but "when does
// a deadlock occur?" keeps "deadlock" and is a content question.
const LOGISTICS = new Set(`due deadline submit submitted submitting submission missing overdue late early when today tonight tomorrow yesterday
  week weekend weekly month next last coming upcoming soon left still first schedule timetable calendar time date day
  announce announced announcement said say lecturer prof professor tutor ta weight weightage worth grade mark score result
  remind reminder task todo plan quiz exam midterm mid term final test assignment lab project tutorial homework hw venue room
  cover covered start begin end finish need should study revise revision prepare happen happening anything any much many long
  did done get got go going
  monday tuesday wednesday thursday friday saturday sunday mon tue tues wed thu thur thurs fri sat sun
  january february march april may june july august september october november december jan feb mar apr jun jul aug sep sept oct nov dec`
  .split(/\s+/).filter(Boolean).map((w) => tokens(w)[0] ?? w));
const CHAT_WORDS = new Set("hi hey hello yo thank thanks ty ok okay cool nice great awesome lol bye good morning night evening sure yes yeah no nope sorry".split(" ").map((w) => tokens(w)[0] ?? w));
// Module codes ("cs2040s"), lecture labels ("l3"), numbers and ordinals.
const NOT_A_SUBJECT = /^([a-z]{2,4}\d{4}[a-z]{0,2}|[a-z]\d{1,2}|\d+|\d+(st|nd|rd|th))$/;
const CHAT = /^(hi|hey|hello|yo|thanks?|thank you|ty|ok(ay)?|cool|nice|lol|bye|good (morning|night|evening)|who are you|how are you)\b/i;
export function isContentQuestion(question: string): boolean {
  const q = question.trim();
  // "thanks, that helps": a short reply, not a question.
  if (CHAT.test(q) && q.split(/\s+/).length <= 3) return false;
  return queryTokens(q).some((t) => !LOGISTICS.has(t) && !CHAT_WORDS.has(t) && !NOT_A_SUBJECT.test(t));
}

// --- answering ----------------------------------------------------------------------

// Asked with no SOURCES (a question about dates, tasks or chat): the model
// still must not teach from what it happens to know.
export const NO_SOURCES_RULE = "None of the student's material matched this question. Answer about dates, tasks and the course from FACTS. If they ask what something means or how it works, say their material doesn't seem to cover it; never answer course content from general knowledge.";

export const NOT_FOUND = "I couldn't find that in your material. Try other words, or open the slides from the module page.";

// `grounded` is set only for an answer about course content: true when it
// cites the student's material, false when the model answered without a
// citation (the chat flags that one). Answers about dates, tasks or chat come
// from the student's facts, and "couldn't find it" says so itself, so those
// leave it unset.
export type Answer = { reply: string; sources: SourceRef[]; grounded?: boolean; askedModel: boolean };
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
  // "why?" is as much a content question as the one before it; "when is it
  // due?" after a content question is still about dates.
  const content = isContentQuestion(question) || (!!input.context && !queryTokens(question).length && isContentQuestion(input.context));
  if (!hits.length && content) return { reply: NOT_FOUND, sources: [], askedModel: false };
  const system = hits.length
    ? `${input.system}\n\n${SOURCES_RULES}\n\nFACTS\n${input.facts}\n\nSOURCES\n${sourcesBlock(hits)}`
    : `${input.system}\n\n${NO_SOURCES_RULE}\n\nFACTS\n${input.facts}`;
  const out = await input.llm([
    { role: "system", content: system },
    ...historyForModel(input.earlier.slice(-8)),
    { role: "user", content: question },
  ], { maxTokens: hits.length ? 700 : 400, temperature: hits.length ? 0.3 : 0.6 });
  const clean = out.replace(/<think>[\s\S]*?<\/think>/g, "").replace(/\*\*(.+?)\*\*/g, "$1").replace(/^#+\s*/gm, "").trim();
  const cited = citedSources(clean, hits);
  const grounded = cited.grounded ? true : content ? false : undefined;
  return { reply: cited.text, sources: cited.sources, ...(grounded !== undefined ? { grounded } : {}), askedModel: true };
}
