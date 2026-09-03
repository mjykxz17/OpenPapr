import { htmlToText } from "./html-text";
// Canvas has two different notions of "the course's files". The Files tab
// lists what was uploaded there; anything a lecturer pastes into an
// announcement, a page or the syllabus is stored with hidden:true and never
// appears in that listing. For some courses the entire deck set lives in the
// second category — IFS4103's Files tab holds two recruitment posters while
// its actual lecture slides are only reachable through announcement HTML.
//
// Every such link carries the file id in its path, whichever form it takes:
//   /courses/96697/files/2099991
//   https://canvas.nus.edu.sg/courses/96697/files/2099991/download?wrap=1
//   https://canvas.nus.edu.sg/api/v1/courses/96697/files/2099991
//   /files/31337/preview
const FILE_LINK = /\/files\/(\d+)/g;

export function extractCanvasFileIds(html: string | null | (string | null)[]): number[] {
  const sources = Array.isArray(html) ? html : [html];
  const seen = new Set<number>();
  for (const source of sources) {
    if (!source) continue;
    for (const m of source.matchAll(FILE_LINK)) seen.add(Number(m[1]));
  }
  return [...seen];
}

// The link's surroundings are the best clue to what a file IS: "intro.pdf"
// says nothing, "intro.pdf" linked from a page titled "Introduction — please
// bring your laptops" under "slides for today" is a lecture deck. Each source
// carries a label (announcement title, page title, "Syllabus") and the text
// window around the link is kept for the categoriser. First mention wins.
export interface FileLinkSource { label: string; html: string | null }
export interface FileLink { id: number; linkedFrom: string; context: string }

const CONTEXT_WINDOW = 220; // characters of HTML either side of the link
const CONTEXT_MAX = 200;

// A window cut out of HTML usually starts or ends mid-tag; drop the fragments
// so they do not leak into the text as "p>" or "<a href=".
const textOf = (fragment: string) =>
  htmlToText(fragment.replace(/^[^<]*>/, "").replace(/<[^>]*$/, "")).replace(/\s+/g, " ");

export function extractCanvasFileLinks(sources: FileLinkSource[]): FileLink[] {
  const seen = new Map<number, FileLink>();
  for (const { label, html } of sources) {
    if (!html) continue;
    for (const m of html.matchAll(FILE_LINK)) {
      const id = Number(m[1]);
      if (seen.has(id)) continue;
      const at = m.index ?? 0;
      // The match sits inside a tag's attribute; read the text on either
      // side of that whole tag so the anchor text lands in the window.
      const tagStart = Math.max(0, html.lastIndexOf("<", at));
      const tagEnd = html.indexOf(">", at);
      const before = textOf(html.slice(Math.max(0, tagStart - CONTEXT_WINDOW), tagStart)).slice(-90);
      const after = tagEnd === -1 ? "" : textOf(html.slice(tagEnd + 1, tagEnd + 1 + CONTEXT_WINDOW)).slice(0, CONTEXT_MAX - 90);
      const context = `${before} ${after}`.replace(/\s+/g, " ").trim().slice(0, CONTEXT_MAX);
      seen.set(id, { id, linkedFrom: label, context });
    }
  }
  return [...seen.values()];
}
