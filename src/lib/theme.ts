// Appearance: light / dark / follow the system, plus one accent colour.
// Stored per browser in localStorage and applied to <html> as
// data-theme="light|dark" and data-accent="<name>" before first paint (see
// themeBootScript), so the page never flashes the wrong theme.

export type ThemePref = "light" | "dark" | "system";
export type AccentName = "teal" | "blue" | "indigo" | "violet" | "rose" | "graphite";

export const THEME_KEY = "op-theme";
export const ACCENT_KEY = "op-accent";
export const DEFAULT_ACCENT: AccentName = "teal";

// Swatch colours for the picker, per theme. The real values live in
// globals.css; these only draw the swatches. Every pair clears WCAG AA:
// the light value ≥5.3:1 on the surface and under white text, the dark
// value ≥8.8:1 on the dark surfaces and under near-black text.
export const ACCENTS: { name: AccentName; label: string; light: string; dark: string }[] = [
  { name: "teal", label: "Teal", light: "#0f766e", dark: "#2dd4bf" },
  { name: "blue", label: "Blue", light: "#1d4ed8", dark: "#93c5fd" },
  { name: "indigo", label: "Indigo", light: "#4338ca", dark: "#a5b4fc" },
  { name: "violet", label: "Violet", light: "#7c3aed", dark: "#c4b5fd" },
  { name: "rose", label: "Rose", light: "#be123c", dark: "#fda4af" },
  { name: "graphite", label: "Graphite", light: "#3f3f46", dark: "#d4d4d8" },
];

export const isAccent = (v: unknown): v is AccentName => ACCENTS.some((a) => a.name === v);
export const isThemePref = (v: unknown): v is ThemePref => v === "light" || v === "dark" || v === "system";

export function resolveTheme(pref: ThemePref): "light" | "dark" {
  if (pref !== "system") return pref;
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function applyAppearance(pref: ThemePref, accent: AccentName) {
  const el = document.documentElement;
  el.dataset.theme = resolveTheme(pref);
  el.dataset.accent = accent;
  el.style.colorScheme = el.dataset.theme;
}

// Runs inline in <head> before the body paints. Kept tiny and defensive:
// storage can be blocked, and a bad value must fall back, not throw.
export const themeBootScript = `(function(){try{var d=document.documentElement,t=localStorage.getItem("${THEME_KEY}")||"system",a=localStorage.getItem("${ACCENT_KEY}")||"${DEFAULT_ACCENT}";if(!/^(teal|blue|indigo|violet|rose|graphite)$/.test(a))a="${DEFAULT_ACCENT}";var dark=t==="dark"||(t!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches);d.dataset.theme=dark?"dark":"light";d.dataset.accent=a;d.style.colorScheme=dark?"dark":"light";}catch(e){}})();`;
