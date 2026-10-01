"use client";

import { useEffect, useState, type ReactNode } from "react";

export type ModuleTab = { id: string; label: string; count?: number | null };

// The module page's tabs. Every panel is rendered on the server; this only
// picks which one shows. The tab lives in the URL hash (#updates), so a link
// can open one, and a link to an announcement (#a-12) opens Updates on it.
export function ModuleTabs({ tabs, panels }: { tabs: ModuleTab[]; panels: Record<string, ReactNode> }) {
  const [active, setActive] = useState(tabs[0]!.id);

  useEffect(() => {
    const pick = () => {
      const h = window.location.hash.slice(1);
      if (!h) return;
      if (tabs.some((t) => t.id === h)) { setActive(h); return; }
      // A deep link to something inside a panel: open that panel, then go there.
      const panel = tabs.find((t) => document.getElementById(`panel-${t.id}`)?.querySelector(`[id="${CSS.escape(h)}"]`));
      if (panel) {
        setActive(panel.id);
        requestAnimationFrame(() => {
          const el = document.getElementById(h);
          el?.scrollIntoView({ block: "center" });
          el?.querySelector("details")?.setAttribute("open", "");
        });
      }
    };
    pick();
    window.addEventListener("hashchange", pick);
    return () => window.removeEventListener("hashchange", pick);
  }, [tabs]);

  const choose = (id: string) => {
    setActive(id);
    history.replaceState(null, "", id === tabs[0]!.id ? window.location.pathname + window.location.search : `#${id}`);
  };

  return (
    <div className="mt-7">
      <div role="tablist" aria-label="Module sections" className="-mx-4 flex gap-1 overflow-x-auto border-b border-line px-4 [scrollbar-width:none] sm:mx-0 sm:px-0">
        {tabs.map((t) => (
          <button key={t.id} type="button" role="tab" id={`tab-${t.id}`} aria-selected={active === t.id} aria-controls={`panel-${t.id}`}
            onClick={() => choose(t.id)}
            onKeyDown={(e) => {
              const i = tabs.findIndex((x) => x.id === active);
              if (e.key === "ArrowRight") { e.preventDefault(); const n = tabs[(i + 1) % tabs.length]!; choose(n.id); document.getElementById(`tab-${n.id}`)?.focus(); }
              if (e.key === "ArrowLeft") { e.preventDefault(); const n = tabs[(i - 1 + tabs.length) % tabs.length]!; choose(n.id); document.getElementById(`tab-${n.id}`)?.focus(); }
            }}
            tabIndex={active === t.id ? 0 : -1}
            className={`-mb-px flex h-11 shrink-0 items-center gap-1.5 border-b-2 px-3 text-[14px] transition-colors ${active === t.id ? "border-accent font-semibold text-ink" : "border-transparent text-ink-2 hover:text-ink"}`}>
            {t.label}
            {t.count != null && t.count > 0 && <span className="text-[12px] font-normal tabular-nums text-ink-3">{t.count}</span>}
          </button>
        ))}
      </div>
      {tabs.map((t) => (
        <div key={t.id} role="tabpanel" id={`panel-${t.id}`} aria-labelledby={`tab-${t.id}`} hidden={active !== t.id} className="pt-6">
          {panels[t.id]}
        </div>
      ))}
    </div>
  );
}
