// The demo banner can be put away for the rest of the visit (a phone has
// little room above the page); it comes back on the next one.
export const DEMO_BANNER_KEY = "demo-banner-hidden";

type Store = Pick<Storage, "getItem" | "setItem">;

export function demoBannerHidden(store: Store | null): boolean {
  try { return store?.getItem(DEMO_BANNER_KEY) === "1"; } catch { return false; }
}

export function hideDemoBanner(store: Store | null): void {
  try { store?.setItem(DEMO_BANNER_KEY, "1"); } catch { /* private mode: it just shows again */ }
}
