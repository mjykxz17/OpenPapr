// What Papi says on its own (a reminder, a one-liner). A speech bubble would
// cover the page, so the line waits as a dot on Papi until the student comes
// to it: hovering or focusing Papi shows it as a bubble, opening the chat
// shows it at the top. A newer line replaces an older one.

export type Note = { text: string; seen: boolean } | null;

export const noteArrived = (text: string): Note => ({ text, seen: false });

export const noteSeen = (n: Note): Note => (n ? { ...n, seen: true } : n);

// Whether Papi shows its "something to say" dot.
export const noteWaiting = (n: Note): boolean => Boolean(n && !n.seen);

// The line to show as a bubble when the pointer or focus reaches Papi: only
// one not yet seen, so passing over Papi again doesn't repeat it.
export const noteToSay = (n: Note): string | null => (n && !n.seen ? n.text : null);
