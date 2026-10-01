"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Hit = { kind: string; title: string; snippet: string; href: string; external: boolean; code: string | null; at: number | null };

const KIND: Record<string, string> = {
  guide: "Guide", announcement: "Announcement", reply: "Lecturer reply", discussion: "Discussion",
  work: "Canvas", task: "Task", file: "File", module: "Module",
};

// Anything that wants to open search (the rail button, the phone tab) sends this.
export const OPEN_SEARCH = "openpapr:search";
export const openSearch = () => window.dispatchEvent(new Event(OPEN_SEARCH));

// ⌘K (or Ctrl+K, or "/") from anywhere: one box over guides, announcements,
// what lecturers said, Canvas work, tasks and files.
export function SearchPalette() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [sel, setSel] = useState(0);
  const [loading, setLoading] = useState(false);
  const input = useRef<HTMLInputElement | null>(null);
  const list = useRef<HTMLUListElement | null>(null);
  const router = useRouter();

  const show = useCallback(() => { setOpen(true); setSel(0); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen((o) => !o); }
      else if (e.key === "/" && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); show(); }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_SEARCH, show);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener(OPEN_SEARCH, show); };
  }, [show]);
  useEffect(() => { if (open) setTimeout(() => input.current?.select(), 0); }, [open]);

  // Ask as the student types, a beat after they pause.
  useEffect(() => {
    if (!open) return;
    const query = q.trim();
    if (query.length < 2) { setHits(null); return; }
    const ctl = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await fetch(`/api/search?q=${encodeURIComponent(query)}`, { signal: ctl.signal });
        if (r.ok) { setHits(((await r.json()) as { results: Hit[] }).results); setSel(0); }
      } catch { /* superseded */ }
      setLoading(false);
    }, 160);
    return () => { clearTimeout(timer); ctl.abort(); };
  }, [q, open]);

  const go = (h: Hit) => {
    setOpen(false);
    if (h.external) window.open(h.href, "_blank", "noreferrer");
    else router.push(h.href);
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") setOpen(false);
    else if (e.key === "ArrowDown" && hits?.length) { e.preventDefault(); setSel((s) => Math.min(hits.length - 1, s + 1)); }
    else if (e.key === "ArrowUp" && hits?.length) { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
    else if (e.key === "Enter" && hits?.[sel]) { e.preventDefault(); go(hits[sel]); }
  };
  useEffect(() => { list.current?.querySelector(`[data-i="${sel}"]`)?.scrollIntoView({ block: "nearest" }); }, [sel]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-ink/30 px-3 pt-[8vh] backdrop-blur-[2px] sm:pt-[12vh]" onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
      <div role="dialog" aria-modal="true" aria-label="Search" className="flex max-h-[76vh] w-full max-w-[640px] flex-col overflow-hidden rounded-[12px] border border-line bg-panel shadow-2xl">
        <div className="flex items-center gap-2 border-b border-line px-4">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="shrink-0 text-ink-3" aria-hidden><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
          <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKeyDown}
            placeholder="Search guides, announcements, tasks, files…" aria-label="Search" role="combobox" aria-expanded={Boolean(hits?.length)} aria-controls="search-results"
            aria-activedescendant={hits?.length ? `search-hit-${sel}` : undefined}
            className="h-14 min-w-0 flex-1 bg-transparent text-[16px] text-ink outline-none placeholder:text-ink-3" />
          <button type="button" onClick={() => setOpen(false)} className="shrink-0 rounded border border-line px-1.5 py-0.5 text-[11px] text-ink-3 hover:text-ink">Esc</button>
        </div>
        <ul ref={list} id="search-results" role="listbox" className="min-h-0 flex-1 overflow-y-auto py-1">
          {q.trim().length < 2 ? (
            <li className="px-4 py-6 text-center text-[13px] text-ink-3">Type a topic, a lecturer&apos;s name, a quiz, a file… <span className="hidden sm:inline">· ⌘K or / opens this anywhere</span></li>
          ) : hits && hits.length === 0 && !loading ? (
            <li className="px-4 py-6 text-center text-[13px] text-ink-3">Nothing matches “{q.trim()}”.</li>
          ) : (
            hits?.map((h, i) => (
              <li key={`${h.href}-${i}`} id={`search-hit-${i}`} data-i={i} role="option" aria-selected={i === sel}
                onMouseMove={() => setSel(i)} onClick={() => go(h)}
                className={`mx-1 cursor-pointer rounded-md px-3 py-2.5 ${i === sel ? "bg-accent-soft" : ""}`}>
                <div className="flex items-baseline gap-2">
                  <span className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.05em] text-ink-3">{KIND[h.kind] ?? h.kind}</span>
                  {h.code && <span className="shrink-0 font-mono text-[12px] font-medium text-ink-2">{h.code}</span>}
                  <span className="min-w-0 truncate text-[14px] font-medium text-ink">{h.title}</span>
                  {h.external && <span className="ml-auto shrink-0 text-[11px] text-ink-3">Canvas ↗</span>}
                </div>
                {h.snippet && <p className="mt-0.5 line-clamp-2 text-[13px] leading-snug text-ink-2">{h.snippet}</p>}
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}
