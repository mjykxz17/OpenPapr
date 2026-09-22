"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { deckProxyUrl, slideImageUrl } from "@/lib/slide-citation";
import type { SlideRef } from "@/components/slide-panel-context";

export type OpenDeck = { deck: string; page: number };
export type PanelMode = "slide" | "split";

type Props = {
  moduleId: number;
  /** Deck stems the module has as PDFs — the "+ Open" list. */
  decks: string[];
  tabs: OpenDeck[];
  active: string; // deck stem of the active tab
  mode: PanelMode;
  onTabs: (tabs: OpenDeck[], active: string) => void;
  onMode: (mode: PanelMode) => void;
  onClose: () => void;
};

const pageCounts = new Map<string, number>();

// The side panel: open decks as pill tabs, one slide rendered from the deck
// PDF, and — in split mode — a note anchored to that slide. All state that
// should survive a reload (tabs, active tab, page, mode) lives in the parent;
// this component only owns transient fetch state.
export function SlidePanel({ moduleId, decks, tabs, active, mode, onTabs, onMode, onClose }: Props) {
  const tab = tabs.find((t) => t.deck === active) ?? tabs[0];
  const [total, setTotal] = useState<number | null>(tab ? (pageCounts.get(tab.deck) ?? null) : null);
  const [picking, setPicking] = useState(false);
  const [imgState, setImgState] = useState<"loading" | "ok" | "error">("loading");
  const panelRef = useRef<HTMLDivElement | null>(null);

  // Page count per deck, once.
  useEffect(() => {
    if (!tab) return;
    const known = pageCounts.get(tab.deck);
    if (known) {
      setTotal(known);
      return;
    }
    let cancelled = false;
    setTotal(null);
    fetch(`/api/modules/${moduleId}/deck/info?name=${encodeURIComponent(tab.deck)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancelled || !j?.pages) return;
        pageCounts.set(tab.deck, j.pages);
        setTotal(j.pages);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [moduleId, tab?.deck]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => setImgState("loading"), [tab?.deck, tab?.page]);

  const setPage = useCallback(
    (page: number) => {
      if (!tab) return;
      const max = total ?? Number.MAX_SAFE_INTEGER;
      const next = Math.max(1, Math.min(max, page));
      onTabs(tabs.map((t) => (t.deck === tab.deck ? { ...t, page: next } : t)), tab.deck);
    },
    [tab, tabs, total, onTabs],
  );

  function closeTab(deck: string) {
    const rest = tabs.filter((t) => t.deck !== deck);
    if (rest.length === 0) {
      onClose();
      return;
    }
    onTabs(rest, deck === active ? rest[Math.max(0, tabs.findIndex((t) => t.deck === deck) - 1)].deck : active);
  }

  function openDeck(deck: string) {
    setPicking(false);
    if (tabs.some((t) => t.deck === deck)) onTabs(tabs, deck);
    else onTabs([...tabs, { deck, page: 1 }], deck);
  }

  // Arrow keys page when the panel (not its textarea) has focus.
  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    if ((e.target as HTMLElement).tagName === "TEXTAREA" || (e.target as HTMLElement).tagName === "INPUT") return;
    if (e.key === "ArrowLeft") { e.preventDefault(); setPage((tab?.page ?? 1) - 1); }
    if (e.key === "ArrowRight") { e.preventDefault(); setPage((tab?.page ?? 1) + 1); }
  }

  if (!tab) return null;
  const unopened = decks.filter((d) => !tabs.some((t) => t.deck === d));

  return (
    <div
      ref={panelRef}
      tabIndex={-1}
      onKeyDown={onKey}
      aria-label="Slide viewer"
      className="flex min-h-0 flex-col overflow-hidden rounded-[10px] border border-line bg-[#f4f4f5] outline-none focus-visible:ring-2 focus-visible:ring-accent-soft"
    >
      {/* Tabs */}
      <div role="tablist" aria-label="Open files" className="flex h-12 items-center gap-1.5 overflow-x-auto border-b border-line bg-panel px-3 [scrollbar-width:none]">
        {tabs.map((t) => {
          const on = t.deck === active;
          return (
            <div key={t.deck} className={`flex h-[30px] shrink-0 items-center rounded-full border pl-3 pr-1 text-[13px] ${on ? "border-accent bg-accent-soft font-medium text-ink" : "border-line-2 bg-panel text-ink-2"}`}>
              <button type="button" role="tab" aria-selected={on} onClick={() => onTabs(tabs, t.deck)} className="flex items-center gap-1.5">
                <span className="max-w-[160px] truncate">{t.deck}</span>
                <span className={`text-xs tabular-nums ${on ? "text-accent" : "text-ink-3"}`}>{t.page}</span>
              </button>
              <button type="button" aria-label={`Close ${t.deck}`} onClick={() => closeTab(t.deck)} className="ml-1 flex h-5 w-5 items-center justify-center rounded-full text-ink-3 hover:bg-ink/[0.06] hover:text-ink">×</button>
            </div>
          );
        })}
        <div className="relative shrink-0">
          <button type="button" aria-haspopup="listbox" aria-expanded={picking} onClick={() => setPicking((p) => !p)} className="flex h-[30px] w-[30px] items-center justify-center rounded-full border border-dashed border-line-2 text-base text-ink-2 hover:border-accent hover:text-accent" aria-label="Open another deck">+</button>
          {picking && (
            <ul role="listbox" className="absolute left-0 top-9 z-20 max-h-72 w-64 overflow-y-auto rounded-md border border-line bg-panel py-1 shadow-lg">
              {unopened.length === 0 && <li className="px-3 py-2 text-[13px] text-ink-3">Every deck is open</li>}
              {unopened.map((d) => (
                <li key={d}>
                  <button type="button" role="option" aria-selected={false} onClick={() => openDeck(d)} className="block w-full truncate px-3 py-2 text-left text-[13px] text-ink hover:bg-accent-soft">{d}</button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="ml-auto flex shrink-0 gap-0.5 rounded-md bg-[#f4f4f5] p-0.5">
          <button type="button" aria-pressed={mode === "slide"} onClick={() => onMode("slide")} className={`h-[26px] rounded px-2.5 text-xs font-medium ${mode === "slide" ? "bg-panel text-ink shadow-sm" : "text-ink-2"}`}>Slide</button>
          <button type="button" aria-pressed={mode === "split"} onClick={() => onMode("split")} className={`h-[26px] rounded px-2.5 text-xs font-medium ${mode === "split" ? "bg-panel text-ink shadow-sm" : "text-ink-2"}`}>Slide + notes</button>
        </div>
        <button type="button" aria-label="Close viewer" onClick={onClose} className="ml-1 flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-md text-lg text-ink-2 hover:bg-ink/[0.06] hover:text-ink">×</button>
      </div>

      {/* Page controls */}
      <div className="flex h-10 items-center justify-between gap-2 border-b border-line bg-panel px-3">
        <div className="flex items-center gap-1">
          <button type="button" aria-label="Previous page" onClick={() => setPage(tab.page - 1)} disabled={tab.page <= 1} className="h-[30px] w-[30px] rounded-md border border-line-2 bg-panel text-ink-2 disabled:opacity-40">‹</button>
          <label className="flex items-center gap-1 px-1 text-[13px] tabular-nums text-ink-2">
            <span className="sr-only">Page</span>
            <input
              type="number"
              min={1}
              max={total ?? undefined}
              value={tab.page}
              onChange={(e) => { const n = Number(e.target.value); if (Number.isInteger(n)) setPage(n); }}
              className="h-7 w-12 rounded-md border border-line-2 bg-panel text-center text-[13px] tabular-nums text-ink [appearance:textfield] focus:border-accent focus:outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            />
            <span>/ {total ?? "…"}</span>
          </label>
          <button type="button" aria-label="Next page" onClick={() => setPage(tab.page + 1)} disabled={total !== null && tab.page >= total} className="h-[30px] w-[30px] rounded-md border border-line-2 bg-panel text-ink-2 disabled:opacity-40">›</button>
        </div>
        <a href={deckProxyUrl(moduleId, tab.deck, tab.page)} target="_blank" rel="noreferrer" className="text-[13px] text-ink-2 hover:text-accent">Full PDF ↗</a>
      </div>

      {/* Slide + notes */}
      <div className="flex min-h-0 flex-grow flex-col gap-3 overflow-hidden p-3">
        <div className={`relative w-full overflow-hidden rounded-md border border-line bg-panel shadow-sm ${mode === "split" ? "shrink-0" : "min-h-0 flex-grow"}`} style={mode === "split" ? { maxHeight: "42%" } : undefined}>
          {imgState !== "ok" && (
            <div className="absolute inset-0 flex items-center justify-center text-[13px] text-ink-3">
              {imgState === "loading" ? "Rendering slide…" : "This page could not be rendered."}
            </div>
          )}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            key={`${tab.deck}#${tab.page}`}
            src={slideImageUrl(moduleId, tab.deck, tab.page)}
            alt={`${tab.deck}, page ${tab.page}`}
            onLoad={() => setImgState("ok")}
            onError={() => setImgState("error")}
            className={`block h-full w-full object-contain ${mode === "split" ? "max-h-[38vh]" : ""} ${imgState === "ok" ? "" : "opacity-0"}`}
          />
        </div>
        {mode === "split" && <SlideNote moduleId={moduleId} slide={tab} />}
      </div>
    </div>
  );
}

// One note per slide. Loads on slide change, saves 700ms after the last
// keystroke and on blur. A swap to another slide flushes first, so nothing
// typed is lost to the debounce.
function SlideNote({ moduleId, slide }: { moduleId: number; slide: SlideRef }) {
  const key = `${slide.deck}#${slide.page}`;
  const [text, setText] = useState("");
  const [state, setState] = useState<"loading" | "saved" | "dirty" | "saving" | "error">("loading");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef({ key, text: "", dirty: false });
  latest.current.key = key;

  const save = useCallback(async (forKey: string, markdown: string) => {
    const [deck, page] = [forKey.slice(0, forKey.lastIndexOf("#")), Number(forKey.slice(forKey.lastIndexOf("#") + 1))];
    setState("saving");
    try {
      const r = await fetch(`/api/modules/${moduleId}/notes`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deck, page, markdown }),
      });
      if (!r.ok) throw new Error();
      if (latest.current.key === forKey) {
        latest.current.dirty = false;
        setState("saved");
      }
    } catch {
      if (latest.current.key === forKey) setState("error");
    }
  }, [moduleId]);

  // Load — after flushing whatever the previous slide still had pending.
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    const prev = latest.current;
    if (prev.dirty && prev.key !== key) void save(prev.key, prev.text);
    latest.current = { key, text: "", dirty: false };
    let cancelled = false;
    setState("loading");
    fetch(`/api/modules/${moduleId}/notes?deck=${encodeURIComponent(slide.deck)}&page=${slide.page}`)
      .then((r) => (r.ok ? r.json() : { markdown: "" }))
      .then((j) => {
        if (cancelled) return;
        setText(j.markdown ?? "");
        latest.current.text = j.markdown ?? "";
        setState("saved");
      })
      .catch(() => { if (!cancelled) setState("error"); });
    return () => { cancelled = true; };
  }, [moduleId, slide.deck, slide.page, key, save]);

  // Flush on unmount (panel closed or mode switched).
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
    const l = latest.current;
    if (l.dirty) void save(l.key, l.text);
  }, [save]);

  function onChange(v: string) {
    setText(v);
    latest.current.text = v;
    latest.current.dirty = true;
    setState("dirty");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(key, v), 700);
  }

  function flush() {
    if (timer.current) clearTimeout(timer.current);
    if (latest.current.dirty) void save(key, latest.current.text);
  }

  const status = { loading: "Loading…", saved: "Saved", dirty: "Unsaved", saving: "Saving…", error: "Could not save" }[state];

  return (
    <div className="flex min-h-0 flex-grow flex-col gap-2 rounded-md border border-line bg-panel px-3.5 pt-2.5">
      <div className="flex items-center justify-between">
        <span className="inline-flex items-center rounded bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent">Note · {slide.deck} · {slide.page}</span>
        <span className={`text-xs ${state === "error" ? "text-danger" : "text-ink-3"}`}>{status}</span>
      </div>
      <label className="flex min-h-0 flex-grow flex-col">
        <span className="sr-only">Note on {slide.deck} page {slide.page}</span>
        <textarea
          value={text}
          onChange={(e) => onChange(e.target.value)}
          onBlur={flush}
          disabled={state === "loading"}
          placeholder="Your note on this slide — Markdown, private to you"
          className="min-h-[120px] w-full flex-grow resize-none bg-transparent py-1 text-sm leading-[1.55] text-ink outline-none placeholder:text-ink-3 disabled:opacity-60"
        />
      </label>
      <div className="flex items-center justify-between border-t border-line py-2">
        <button
          type="button"
          onClick={() => onChange(`${text}${text && !text.endsWith("\n") ? "\n" : ""}![${slide.deck} slide ${slide.page}](slide-img:${slide.deck}#${slide.page})\n`)}
          className="text-xs font-medium text-ink-2 hover:text-accent"
        >
          Insert slide image
        </button>
        <span className="text-xs text-ink-3">Autosaves</span>
      </div>
    </div>
  );
}
