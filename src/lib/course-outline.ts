import type { CanvasModule } from "../connectors/canvas/types";
import type { FileLinkSource } from "./canvas-file-links";

// A course's Modules tab, kept as the student sees it: the lecturer's own
// order of the course, week by week, with what each week holds. Files and
// pages are what the harvester follows; links and tools (recordings, Zoom,
// course websites) can't be opened from here, but where they sit is still
// worth knowing.

export type OutlineItem = {
  kind: "file" | "page" | "assignment" | "quiz" | "discussion" | "link" | "tool" | "heading";
  title: string; indent: number; locked?: boolean;
  canvasFileId?: number; pageUrl?: string; contentId?: number; url?: string;
};
export type OutlineWeek = { name: string; unlockAt: number | null; items: OutlineItem[] };
export type CourseOutline = OutlineWeek[];

const KIND: Record<string, OutlineItem["kind"]> = {
  File: "file", Page: "page", Assignment: "assignment", Quiz: "quiz", Discussion: "discussion",
  ExternalUrl: "link", ExternalTool: "tool", SubHeader: "heading",
};

export function outlineFrom(mods: CanvasModule[]): CourseOutline {
  return [...mods].sort((a, b) => (a.position ?? 0) - (b.position ?? 0)).map((m) => ({
    name: m.name,
    unlockAt: m.unlock_at ? Date.parse(m.unlock_at) : null,
    items: [...(m.items ?? [])].sort((a, b) => (a.position ?? 0) - (b.position ?? 0)).flatMap((i): OutlineItem[] => {
      const kind = KIND[i.type];
      if (!kind) return [];
      const item: OutlineItem = { kind, title: i.title, indent: i.indent ?? 0 };
      if (i.content_details?.locked_for_user) item.locked = true;
      if (kind === "file" && i.content_id) item.canvasFileId = i.content_id;
      if (kind === "page" && i.page_url) item.pageUrl = i.page_url;
      if ((kind === "assignment" || kind === "quiz" || kind === "discussion") && i.content_id) item.contentId = i.content_id;
      if (kind === "link" || kind === "tool") { const url = i.external_url ?? i.html_url; if (url) item.url = url; }
      return [item];
    }),
  }));
}

export function parseOutline(json: string | null | undefined): CourseOutline | null {
  if (!json) return null;
  try { return JSON.parse(json) as CourseOutline; } catch { return null; }
}

// The pages the Modules tab leads to, open to this student.
export const outlinePages = (outline: CourseOutline) =>
  outline.flatMap((w) => w.items).filter((i) => i.kind === "page" && i.pageUrl && !i.locked).map((i) => ({ url: i.pageUrl!, title: i.title }));

// Its files, as links for the harvester, each labelled with its week so the
// categoriser sees "Week 3 · Lecture" next to "notes.pdf".
export const outlineFileLinks = (outline: CourseOutline): FileLinkSource[] =>
  outline.map((w) => ({
    label: `Modules: ${w.name}`,
    html: w.items.filter((i) => i.kind === "file" && i.canvasFileId).map((i) => `<p><a href="/files/${i.canvasFileId}">${i.title.replace(/</g, "&lt;")}</a></p>`).join("") || null,
  }));
