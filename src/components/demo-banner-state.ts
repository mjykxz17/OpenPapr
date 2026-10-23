// The demo banner can be put away for the rest of the visit (a phone has
// little room above the page); it comes back on the next one.
export const DEMO_BANNER_KEY = "demo-banner-hidden";
// Set on <html> while the banner is put away. The banner is hidden by CSS
// keyed on it, so a dismissed banner is never painted, not even for a frame
// while a page loads.
export const DEMO_BANNER_ATTR = "demoBanner";

type Store = Pick<Storage, "setItem">;

export function hideDemoBanner(store: Store | null): void {
  try { store?.setItem(DEMO_BANNER_KEY, "1"); } catch { /* private mode: it just shows again */ }
}

// Runs inline in <head> before the body paints, like the theme script.
export const demoBannerBootScript = `(function(){try{if(sessionStorage.getItem("${DEMO_BANNER_KEY}")==="1")document.documentElement.dataset.${DEMO_BANNER_ATTR}="hidden";}catch(e){}})();`;
