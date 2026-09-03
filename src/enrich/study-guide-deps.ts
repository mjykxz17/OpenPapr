// One import surface for the guide generator's collaborators, so
// generate-guide.ts does not reach into two modules for what is one concern.
export { createGuideGenerator, figureSlides, slidePages, preferColourDeck, selectGuideDecks, validateChapter, normalizeFences } from "./study-guide";
export type { CompatConfig } from "./openai-compat";
