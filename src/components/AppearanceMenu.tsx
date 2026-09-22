"use client";

import { useEffect, useRef, useState } from "react";
import {
  ACCENTS, ACCENT_KEY, DEFAULT_ACCENT, THEME_KEY,
  applyAppearance, isAccent, isThemePref, type AccentName, type ThemePref,
} from "@/lib/theme";

const THEMES: { value: ThemePref; label: string; icon: React.ReactNode }[] = [
  { value: "light", label: "Light", icon: <path d="M12 4V2m0 20v-2m8-8h2M2 12h2m13.66-5.66 1.41-1.41M4.93 19.07l1.41-1.41m0-11.32L4.93 4.93m14.14 14.14-1.41-1.41M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z" /> },
  { value: "dark", label: "Dark", icon: <path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11Z" /> },
  { value: "system", label: "System", icon: <><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></> },
];

// Appearance lives in the rail, above sign-out — one fixed place on every
// page. A popover with the theme (light / dark / follow the system) and six
// accent swatches. Choices apply instantly and are remembered per browser.
export function AppearanceMenu() {
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState<ThemePref>("system");
  const [accent, setAccent] = useState<AccentName>(DEFAULT_ACCENT);
  const [resolved, setResolved] = useState<"light" | "dark">("light");
  const wrap = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    try {
      const t = localStorage.getItem(THEME_KEY);
      const a = localStorage.getItem(ACCENT_KEY);
      if (isThemePref(t)) setTheme(t);
      if (isAccent(a)) setAccent(a);
    } catch {}
    setResolved(document.documentElement.dataset.theme === "dark" ? "dark" : "light");
  }, []);

  // "System" follows the OS live, not just at load.
  useEffect(() => {
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const on = () => { applyAppearance("system", accent); setResolved(mq.matches ? "dark" : "light"); };
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [theme, accent]);

  function choose(nextTheme: ThemePref, nextAccent: AccentName) {
    setTheme(nextTheme);
    setAccent(nextAccent);
    applyAppearance(nextTheme, nextAccent);
    setResolved(document.documentElement.dataset.theme === "dark" ? "dark" : "light");
    try {
      localStorage.setItem(THEME_KEY, nextTheme);
      localStorage.setItem(ACCENT_KEY, nextAccent);
    } catch {}
  }

  // Close on outside click and Esc.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("pointerdown", onDown); window.removeEventListener("keydown", onKey); };
  }, [open]);

  return (
    <div ref={wrap} className="relative">
      <button
        type="button"
        aria-label="Appearance"
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Appearance"
        onClick={() => setOpen((o) => !o)}
        className={`flex h-11 w-11 items-center justify-center rounded-md transition-colors ${open ? "bg-accent-soft text-accent" : "text-ink-2 hover:bg-ink/[0.05] hover:text-ink"}`}
      >
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M12 3a9 9 0 1 0 0 18c.9 0 1.5-.7 1.5-1.5 0-.4-.2-.8-.4-1.1-.3-.3-.4-.7-.4-1.1 0-.8.7-1.5 1.5-1.5H16a5 5 0 0 0 5-5c0-4.4-4-7.8-9-7.8Z" />
          <circle cx="7.5" cy="10.5" r="1" fill="currentColor" /><circle cx="10.5" cy="7" r="1" fill="currentColor" /><circle cx="15" cy="7.5" r="1" fill="currentColor" />
        </svg>
      </button>

      {open && (
        <div role="dialog" aria-label="Appearance" className="absolute bottom-0 left-[52px] z-40 w-64 rounded-[10px] border border-line bg-panel p-3.5 shadow-xl">
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.06em] text-ink-2">Theme</p>
          <div role="radiogroup" aria-label="Theme" className="mb-4 grid grid-cols-3 gap-1 rounded-md bg-sunken p-1">
            {THEMES.map((t) => {
              const on = theme === t.value;
              return (
                <button
                  key={t.value}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => choose(t.value, accent)}
                  className={`flex h-14 flex-col items-center justify-center gap-1 rounded text-xs font-medium ${on ? "bg-panel text-ink shadow-sm" : "text-ink-2 hover:text-ink"}`}
                >
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{t.icon}</svg>
                  {t.label}
                </button>
              );
            })}
          </div>

          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.06em] text-ink-2">Accent</p>
          <div role="radiogroup" aria-label="Accent colour" className="grid grid-cols-6 gap-1.5">
            {ACCENTS.map((a) => {
              const on = accent === a.name;
              const color = resolved === "dark" ? a.dark : a.light;
              return (
                <button
                  key={a.name}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  aria-label={a.label}
                  title={a.label}
                  onClick={() => choose(theme, a.name)}
                  className={`flex h-9 w-9 items-center justify-center rounded-full ring-offset-2 ring-offset-panel transition-shadow ${on ? "ring-2 ring-ink" : "hover:ring-2 hover:ring-line-2"}`}
                >
                  <span className="h-7 w-7 rounded-full" style={{ background: color }} />
                </button>
              );
            })}
          </div>
          <p className="mt-3 text-xs text-ink-3">Saved in this browser.</p>
        </div>
      )}
    </div>
  );
}
