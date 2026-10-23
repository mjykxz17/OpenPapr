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
