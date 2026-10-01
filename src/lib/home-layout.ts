// The home screen is a grid of widgets, like a phone's: each one takes a
// snap size and a place, and can be hidden. The layout is saved per student.
import { z } from "zod";

export const SIZES = ["S", "W", "L", "F"] as const;
export type Size = (typeof SIZES)[number];
export const SIZE_NAMES: Record<Size, string> = { S: "Small", W: "Wide", L: "Large", F: "Full width" };

export const WIDGETS = {
  week: { title: "This week", sizes: ["W", "L", "F"] as Size[], size: "F" as Size },
  today: { title: "Today", sizes: ["S", "W", "L"] as Size[], size: "W" as Size },
  next: { title: "Next up", sizes: ["S", "W"] as Size[], size: "S" as Size },
  done: { title: "Completed", sizes: ["S", "W"] as Size[], size: "S" as Size },
  due: { title: "Due this week", sizes: ["W", "L", "F"] as Size[], size: "F" as Size },
  modules: { title: "Modules", sizes: ["W", "L", "F"] as Size[], size: "F" as Size },
} as const;
export type WidgetId = keyof typeof WIDGETS;
export const WIDGET_IDS = Object.keys(WIDGETS) as WidgetId[];

export type Slot = { id: WidgetId; size: Size; hidden: boolean };

export const DEFAULT_LAYOUT: Slot[] = (["week", "today", "next", "done", "due", "modules"] as WidgetId[])
  .map((id) => ({ id, size: WIDGETS[id].size, hidden: false }));

const SlotIn = z.object({ id: z.string(), size: z.string(), hidden: z.boolean().optional() });

// Whatever was saved, return a complete, valid layout: unknown widgets and
// duplicates dropped, a size a widget can't take replaced by its default,
// and widgets added since the layout was saved appended at the end.
export function normalizeLayout(raw: unknown): Slot[] {
  const parsed = z.array(SlotIn).safeParse(raw);
  if (!parsed.success) return DEFAULT_LAYOUT.map((s) => ({ ...s }));
  const out: Slot[] = [];
  const seen = new Set<string>();
  for (const s of parsed.data) {
    if (!(s.id in WIDGETS) || seen.has(s.id)) continue;
    seen.add(s.id);
    const w = WIDGETS[s.id as WidgetId];
    out.push({ id: s.id as WidgetId, size: (w.sizes as string[]).includes(s.size) ? (s.size as Size) : w.size, hidden: Boolean(s.hidden) });
  }
  for (const d of DEFAULT_LAYOUT) if (!seen.has(d.id)) out.push({ ...d });
  return out;
}

export function parseLayout(json: string | null | undefined): Slot[] {
  if (!json) return normalizeLayout(null);
  try { return normalizeLayout(JSON.parse(json)); } catch { return normalizeLayout(null); }
}

// Grid placement per size: four columns on a wide screen, two on a phone;
// rows are a fixed height, except Full, which grows with what it holds.
// Rows size to their content: Small and Wide are one fixed-height row,
// Large two (plus the gap between them), and Full exactly as tall as it is.
export const SIZE_CLASS: Record<Size, string> = {
  S: "col-span-1 row-span-1 h-[168px]",
  W: "col-span-2 row-span-1 h-[168px]",
  L: "col-span-2 row-span-2 h-[352px]",
  F: "col-span-2 md:col-span-4",
};
