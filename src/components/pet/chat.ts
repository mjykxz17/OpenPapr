// The parts of Papi's chat that are plain data, kept apart so they can be tested.

export type Source = { n: number; kind: string; title: string; code: string; moduleId: number; href: string; slide: { deck: string; page: number } | null };
// `grounded` is false when the answer wasn't found in the student's material.
// Older answers (and saved chats) don't carry it; they count as grounded.
export type Msg = { role: "user" | "assistant"; content: string; at?: number; sources?: Source[]; grounded?: boolean };

export const UNGROUNDED_NOTE = "Not found in your material — double-check this.";

export function isUngrounded(m: Msg): boolean {
  return m.role === "assistant" && m.grounded === false;
}

// The chat API's answer, turned into the message shown. Only a real `false`
// marks it as ungrounded; anything else (missing, malformed) does not.
export function answerMessage(body: { reply?: unknown; sources?: unknown; grounded?: unknown } | null, at: number): Msg {
  const reply = typeof body?.reply === "string" && body.reply ? body.reply : "Hmm, I couldn't reach my notes just now. Try again in a moment?";
  const msg: Msg = { role: "assistant", content: reply, at };
  if (Array.isArray(body?.sources)) msg.sources = body.sources as Source[];
  if (body?.grounded === false) msg.grounded = false;
  return msg;
}

// The turns a chat the server doesn't keep sends along with the next
// question: the last few, words only (see sentTurns on the server).
export const turnsToSend = (messages: Msg[], max = 8): { role: Msg["role"]; content: string }[] =>
  messages.filter((m) => m.content.trim()).slice(-max).map(({ role, content }) => ({ role, content }));

// --- an answer's light markdown ------------------------------------------------
// Models answer in markdown: bullet and numbered lists, **bold**, `code`,
// the odd heading. Shown as written, "- Case 1: …" reads as clutter, so an
// answer is drawn as paragraphs, lists and headings, with its [n] citations
// kept as pieces of their own (they become buttons).
export type Block =
  | { kind: "p"; text: string }
  | { kind: "h"; text: string }
  | { kind: "ul" | "ol"; items: string[] };

export function replyBlocks(text: string): Block[] {
  const out: Block[] = [];
  let para: string[] = [];
  const flush = () => { if (para.length) out.push({ kind: "p", text: para.join("\n") }); para = []; };
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    const item = /^\s*(?:([-*•])|\d{1,3}[.)])\s+(.*)$/.exec(line);
    const heading = /^\s*#{1,6}\s+(.*)$/.exec(line);
    const last = out[out.length - 1];
    if (item) {
      flush();
      const kind = item[1] ? "ul" : "ol";
      if (last?.kind === kind) last.items.push(item[2]!);
      else out.push({ kind, items: [item[2]!] });
    } else if (heading) {
      flush();
      out.push({ kind: "h", text: heading[1]!.replace(/\*\*/g, "") });
    } else if (!line.trim()) {
      flush();
    } else if (!para.length && /^\s+\S/.test(raw) && (last?.kind === "ul" || last?.kind === "ol")) {
      // An indented line under a list item carries on that item.
      last.items[last.items.length - 1] += ` ${line.trim()}`;
    } else {
      para.push(line);
    }
  }
  flush();
  return out;
}

export type Inline = { kind: "text" | "bold" | "em" | "code"; text: string } | { kind: "cite"; n: number; text: string };

// One line's **bold**, *emphasis*, `code` and [n] citations. Which [n] are
// really citations is for whoever draws them: those with a source.
export function inlineParts(text: string): Inline[] {
  const out: Inline[] = [];
  const re = /(\*\*[^*\n]+\*\*|`[^`\n]+`|(?<![\w*])\*(?!\s)[^*\n]+(?<!\s)\*(?![\w*])|\[\d+\])/g;
  let at = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > at) out.push({ kind: "text", text: text.slice(at, m.index) });
    const s = m[0];
    if (s.startsWith("**")) out.push({ kind: "bold", text: s.slice(2, -2) });
    else if (s.startsWith("`")) out.push({ kind: "code", text: s.slice(1, -1) });
    else if (s.startsWith("*")) out.push({ kind: "em", text: s.slice(1, -1) });
    else out.push({ kind: "cite", n: Number(s.slice(1, -1)), text: s });
    at = m.index + s.length;
  }
  if (at < text.length) out.push({ kind: "text", text: text.slice(at) });
  return out;
}
