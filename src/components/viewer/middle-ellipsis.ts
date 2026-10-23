// File names often differ only near the end ("… Part 1.pdf", "… Part 2.pdf"),
// so a long one is cut in the middle, not at the end: the head shrinks with
// an ellipsis and the tail always shows. CSS does the cutting; this only
// says where the tail starts.
export function splitForEllipsis(name: string, tail = 14): [head: string, tail: string] {
  if (name.length <= tail + 10) return [name, ""];
  return [name.slice(0, name.length - tail), name.slice(name.length - tail)];
}
