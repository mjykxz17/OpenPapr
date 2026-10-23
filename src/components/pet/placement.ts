// Where Papi, its chat and its speech bubble go. Papi never sits on the page:
// on a wide screen it rests in the left rail (and can be dragged up and down
// it); on a phone it is the Ask tab in the bottom bar. The chat opens beside
// the rail, or as a sheet above the tab bar.

export type Rect = { left: number; top: number; width: number; height: number };
export type Viewport = { w: number; h: number };
export type Box = { left: number; top: number; width: number; height: number };
export type BubbleBox = { left?: number; right?: number; top?: number; bottom?: number };

// The spots the rail and the tab bar keep for Papi (see Rail.tsx).
export const DOCK_ID = "papi-dock";
export const TAB_ID = "papi-tab";

export const RAIL_W = 56;      // the rail's width (w-14)
export const TAB_BAR_H = 72;    // the tab bar plus a little room above it
// Tailwind's sm, the query the rail itself switches on (sm:flex / sm:hidden).
// Asked as a media query rather than compared with innerWidth, so the two
// agree when the browser's font size isn't 16px (40rem is then not 640px).
export const WIDE_QUERY = "(min-width: 40rem)";

export function isPhone(matchMedia: (query: string) => { matches: boolean }): boolean {
  return !matchMedia(WIDE_QUERY).matches;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// Papi's resting spot in the rail, as a distance from the bottom of its dock:
// whatever was saved, kept inside the dock.
export function dockBottom(saved: number, dockH: number, petH: number): number {
  return clamp(Number.isFinite(saved) ? saved : 0, 0, Math.max(0, dockH - petH));
}

// Papi itself, given its dock (the free stretch of the rail) on a wide screen,
// or its tab on a phone.
export function petRect(phone: boolean, slot: Rect, bottom: number, petW: number, petH: number): Rect {
  if (phone) return slot;
  return { left: slot.left + (slot.width - petW) / 2, top: slot.top + slot.height - bottom - petH, width: petW, height: petH };
}

// The chat. Wide: to the right of the rail, its bottom level with Papi, so it
// grows upward and is resized from its top-right corner. Phone: a sheet across
// the bottom, above the tab bar.
export function panelBox(phone: boolean, pet: Rect, vw: Viewport, want: { w: number; h: number }): Box {
  if (phone) {
    const height = Math.round(Math.min(vw.h * 0.78, vw.h - 96));
    return { left: 8, top: vw.h - height - TAB_BAR_H, width: vw.w - 16, height };
  }
  const left = RAIL_W + 8;
  const width = Math.max(0, Math.min(want.w, vw.w - left - 8));
  const height = Math.max(0, Math.min(want.h, vw.h - 16));
  const top = clamp(pet.top + pet.height - height, 8, Math.max(8, vw.h - height - 8));
  return { left, top, width, height };
}

// A speech bubble: beside Papi in the rail, or above its tab on a phone,
// leaning towards the middle of the screen. It sits over the page, so Papi
// only speaks when someone has just touched it; lines it has on its own wait
// as a dot on Papi (see note.ts).
export function bubbleBox(phone: boolean, pet: Rect, vw: Viewport): BubbleBox {
  if (!phone) return { left: RAIL_W + 8, bottom: Math.max(8, vw.h - (pet.top + pet.height)) };
  const bottom = vw.h - pet.top + 6;
  return pet.left + pet.width / 2 > vw.w / 2
    ? { right: Math.max(8, vw.w - (pet.left + pet.width)), bottom }
    : { left: Math.max(8, pet.left), bottom };
}
