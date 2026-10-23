// How a module's study guide is offered, honestly: the filled "Open study
// guide" button only when there is a guide to open; otherwise a quieter
// button that says what will happen, a matching line for the Guides list,
// and the same again, shorter, on the module page's Study guide tile.

export type GuideState = {
  hasGuide: boolean;
  writing: string | null;   // the chapter being written now, if any
  ready: number;
  total: number;
  canWrite: boolean;        // an AI model is set up to write it
  demo?: boolean;           // the demo's guides are written by hand; the rest never come
};

export type GuideEntry = { label: string; primary: boolean; note: string; tile: string };

export function guideEntry(s: GuideState): GuideEntry {
  if (s.hasGuide) return { label: "Open study guide", primary: true, note: "", tile: "Ready" };
  if (s.demo) return { label: "Guide: not in the demo", primary: false, note: "No guide for this module in the demo", tile: "Not in the demo" };
  if (s.writing) return { label: "Guide: writing now", primary: false, note: `No guide yet · writing “${s.writing}”`, tile: `Writing “${s.writing}”` };
  if (s.total > 0) return { label: "Guide: on its way", primary: false, note: `No guide yet · ${s.ready} of ${s.total} chapters written`, tile: `${s.ready} of ${s.total} chapters written` };
  if (!s.canWrite) return { label: "Guide: needs AI turned on", primary: false, note: "No guide yet · turn on AI in Account to write one", tile: "Needs AI turned on in Account" };
  return { label: "Guide: writes itself when slides arrive", primary: false, note: "No guide yet · writes itself when slides arrive", tile: "Writes itself as slides arrive" };
}

// The guide page's own words when there is no guide yet, so it says the same
// thing as the button that led there.
export function guideEmptyText(s: Omit<GuideState, "hasGuide">): string {
  if (s.demo) return "This module has no guide in the demo. The Guides page lists the ones that do.";
  if (s.writing) return `No guide yet. “${s.writing}” is being written now; each topic appears here as soon as it is done.`;
  if (s.total > 0) return `No guide yet. ${s.ready} of ${s.total} chapters are written; each topic appears here as soon as it is done.`;
  if (!s.canWrite) return "No guide yet. Once AI is turned on in Account, it writes itself from this module's lecture slides.";
  return "No guide yet. It writes itself from this module's lecture slides: each topic appears here as soon as it is written, newest slides first.";
}
