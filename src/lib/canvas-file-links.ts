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
