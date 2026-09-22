// How the in-app viewer shows a file, decided from its name (Canvas content
// types are often missing or generic). Pure, so it runs on both sides.
export type FileKind = "pdf" | "office" | "image" | "video" | "audio" | "text" | "none";

const EXT: Record<string, FileKind> = {
  pdf: "pdf",
  ppt: "office", pptx: "office", pps: "office", ppsx: "office", odp: "office", key: "none",
  doc: "office", docx: "office", odt: "office", rtf: "office",
  xls: "office", xlsx: "office", ods: "office",
  png: "image", jpg: "image", jpeg: "image", gif: "image", webp: "image", avif: "image", bmp: "image",
  mp4: "video", webm: "video", mov: "video", m4v: "video",
  mp3: "audio", m4a: "audio", wav: "audio", ogg: "audio", aac: "audio",
  txt: "text", md: "text", csv: "text", tsv: "text", json: "text", log: "text", xml: "text", yml: "text", yaml: "text",
  py: "text", c: "text", h: "text", cpp: "text", hpp: "text", java: "text", js: "text", ts: "text", sql: "text",
  sh: "text", rs: "text", go: "text", rb: "text", r: "text", tex: "text", s: "text", asm: "text", ini: "text", toml: "text",
};

export const fileExt = (name: string): string => (name.match(/\.([a-z0-9]{1,5})$/i)?.[1] ?? "").toLowerCase();

export function fileKind(name: string): FileKind {
  return EXT[fileExt(name)] ?? "none";
}

// The type the bytes are served with. Anything that could run script on this
// origin (html, svg, xml as a document) is served as plain text or as a
// download — never rendered as a page.
export function servedType(name: string): string {
  const ext = fileExt(name);
  switch (fileKind(name)) {
    case "pdf": return "application/pdf";
    case "image": return ext === "jpg" ? "image/jpeg" : `image/${ext}`;
    case "video": return ext === "mov" ? "video/quicktime" : ext === "m4v" ? "video/mp4" : `video/${ext}`;
    case "audio": return ext === "mp3" ? "audio/mpeg" : ext === "m4a" ? "audio/mp4" : `audio/${ext}`;
    case "text": return "text/plain; charset=utf-8";
    default: return "application/octet-stream";
  }
}
