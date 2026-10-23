// How a module's study guide is offered, honestly: the filled "Open study
// guide" button only when there is a guide to open; otherwise a quieter
// button that says what will happen, and a matching line for the Guides list.

export type GuideState = {
  hasGuide: boolean;
  writing: string | null;   // the chapter being written now, if any
  ready: number;
  total: number;
  canWrite: boolean;        // an AI model is set up to write it
  demo?: boolean;           // the demo's guides are written by hand; the rest never come
};

export type GuideEntry = { label: string; primary: boolean; note: string };

export function guideEntry(s: GuideState): GuideEntry {
  if (s.hasGuide) return { label: "Open study guide", primary: true, note: "" };
  if (s.demo) return { label: "Guide: not in the demo", primary: false, note: "No guide for this module in the demo" };
  if (s.writing) return { label: "Guide: writing now", primary: false, note: `No guide yet · writing “${s.writing}”` };
  if (s.total > 0) return { label: "Guide: on its way", primary: false, note: `No guide yet · ${s.ready} of ${s.total} chapters written` };
  if (!s.canWrite) return { label: "Guide: needs AI turned on", primary: false, note: "No guide yet · turn on AI in Account to write one" };
  return { label: "Guide: writes itself when slides arrive", primary: false, note: "No guide yet · writes itself when slides arrive" };
}
