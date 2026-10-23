// The home screen is a grid of widgets, like a phone's: each one takes a
// snap size and a place, and can be hidden. The layout is saved per student.

export const SIZES = ["S", "W", "L", "F"] as const;
export type Size = (typeof SIZES)[number];
export const SIZE_NAMES: Record<Size, string> = { S: "Small", W: "Wide", L: "Large", F: "Full width" };

export const WIDGETS = {
  week: { title: "This week", sizes: ["W", "L", "F"] as Size[], size: "F" as Size },
  today: { title: "Today", sizes: ["S", "W", "L"] as Size[], size: "L" as Size },
  next: { title: "Next up", sizes: ["S", "W"] as Size[], size: "S" as Size },
  done: { title: "Completed", sizes: ["S", "W"] as Size[], size: "S" as Size },
  due: { title: "Calendar", sizes: ["W", "L", "F"] as Size[], size: "L" as Size },
  modules: { title: "Modules", sizes: ["W", "L", "F"] as Size[], size: "F" as Size },
} as const;
export type WidgetId = keyof typeof WIDGETS;
export const WIDGET_IDS = Object.keys(WIDGETS) as WidgetId[];

export type Slot = { id: WidgetId; size: Size; hidden: boolean };

// Each fact once: Today holds the steps, Coming up every deadline (the next
// one first), Modules the courses. The week summary sits under the date.
// "This week", "Next up" and "Completed" repeat those, so they start off the
// home screen; Edit home puts them back.
const START_HIDDEN: WidgetId[] = ["week", "next", "done"];
export const DEFAULT_LAYOUT: Slot[] = (["today", "due", "modules", "week", "next", "done"] as WidgetId[])
  .map((id) => ({ id, size: WIDGETS[id].size, hidden: START_HIDDEN.includes(id) }));

// Checked by hand rather than with zod: this module is in the home page's
// browser bundle, and zod probes for eval there, which the site's
// Content-Security-Policy reports as a violation.
type SlotIn = { id: string; size: string; hidden?: boolean };
const isSlotIn = (v: unknown): v is SlotIn => {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return typeof o.id === "string" && typeof o.size === "string" && (o.hidden === undefined || typeof o.hidden === "boolean");
};

// Whatever was saved, return a complete, valid layout: unknown widgets and
// duplicates dropped, a size a widget can't take replaced by its default,
// and widgets added since the layout was saved appended at the end.
export function normalizeLayout(raw: unknown): Slot[] {
  if (!Array.isArray(raw) || !raw.every(isSlotIn)) return DEFAULT_LAYOUT.map((s) => ({ ...s }));
  const out: Slot[] = [];
  const seen = new Set<string>();
  for (const s of raw) {
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
  // On a phone a large card is as tall as what it holds; a fixed height
  // there mostly meant empty space.
  L: "col-span-2 row-span-2 md:h-[352px]",
  F: "col-span-2 md:col-span-4",
};
