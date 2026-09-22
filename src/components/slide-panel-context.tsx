"use client";

import { createContext, useContext } from "react";

export type SlideRef = { deck: string; page: number };

export type SlidePanelApi = {
  /** Show this deck at this page in the side panel (opening it if closed). */
  show: (ref: SlideRef) => void;
  /** What the panel is showing, or null when closed — lets citation chips mark themselves current. */
  current: SlideRef | null;
};

// Null outside a guide page: the citation chip then falls back to a plain
// link that opens the PDF, so the renderer works anywhere the guide is shown.
export const SlidePanelContext = createContext<SlidePanelApi | null>(null);

export const useSlidePanel = () => useContext(SlidePanelContext);
