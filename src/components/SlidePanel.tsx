"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { deckProxyUrl, slideImageUrl } from "@/lib/slide-citation";
import type { SlideRef } from "@/components/slide-panel-context";

export type OpenDeck = { deck: string; page: number };
export type PanelMode = "slide" | "split" | "notes";

export type NoteSummary = { deck: string; page: number; markdown: string; updatedAt: number };
type NoteScope = "slide" | "deck" | "module";

type Props = {
  moduleId: number;
  /** Pages each deck is cited on in this guide — marked in the filmstrip. */
  cited?: Record<string, number[]>;
  /** Deck stems the module has as PDFs — the "+ Open" list. */
  decks: string[];
  tabs: OpenDeck[];
  active: string; // deck stem of the active tab
  mode: PanelMode;
  /** Whether the thumbnail strip shows under the slide. */
  thumbs: boolean;
  onTabs: (tabs: OpenDeck[], active: string) => void;
  onMode: (mode: PanelMode) => void;
  onThumbs: (on: boolean) => void;
  onClose: () => void;
};

const pageCounts = new Map<string, number>();

// The side panel: open decks as pill tabs, one slide rendered from the deck
// PDF, and — in split mode — a note anchored to that slide. All state that
// should survive a reload (tabs, active tab, page, mode) lives in the parent;
// this component only owns transient fetch state.
export function SlidePanel({ moduleId, cited = {}, decks, tabs, active, mode, thumbs, onTabs, onMode, onThumbs, onClose }: Props) {
  const tab = tabs.find((t) => t.deck === active) ?? tabs[0];
  const [total, setTotal] = useState<number | null>(tab ? (pageCounts.get(tab.deck) ?? null) : null);
  const [picking, setPicking] = useState(false);
  const [imgState, setImgState] = useState<"loading" | "ok" | "error">("loading");
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [scope, setScope] = useState<NoteScope>("slide");
  const [notes, setNotes] = useState<NoteSummary[]>([]);

  // Every note in the module, for the filmstrip dots and the deck/module
  // lists. Refreshed whenever the editor saves.
  const loadNotes = useCallback(() => {
    fetch(`/api/modules/${moduleId}/notes`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (Array.isArray(j?.notes)) setNotes(j.notes); })
      .catch(() => {});
  }, [moduleId]);
  useEffect(() => { loadNotes(); }, [loadNotes]);

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
    if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
    if (e.key === "ArrowLeft") { e.preventDefault(); setPage((tab?.page ?? 1) - 1); }
    if (e.key === "ArrowRight") { e.preventDefault(); setPage((tab?.page ?? 1) + 1); }
  }

  const notedPages = useMemo(() => new Set(notes.filter((n) => n.deck === tab?.deck).map((n) => n.page)), [notes, tab?.deck]);
  const citedPages = useMemo(() => new Set(tab ? cited[tab.deck] ?? [] : []), [cited, tab?.deck]); // eslint-disable-line react-hooks/exhaustive-deps

  // Jump to any deck/page — used by the note lists. Opens the deck as a tab
  // if it is not open yet.
  function goTo(deck: string, page: number) {
    const has = tabs.some((t) => t.deck === deck);
    onTabs(has ? tabs.map((t) => (t.deck === deck ? { ...t, page } : t)) : [...tabs, { deck, page }], deck);
    setScope("slide");
  }

  if (!tab) return null;
  const unopened = decks.filter((d) => !tabs.some((t) => t.deck === d));
  const deckNotes = notes.filter((n) => n.deck === tab.deck);

  return (
    <div
      ref={panelRef}
      tabIndex={-1}
      onKeyDown={onKey}
      aria-label="Slide viewer"
      className={`flex min-h-0 flex-col overflow-hidden rounded-[10px] border border-line bg-sunken outline-none focus-visible:ring-2 focus-visible:ring-accent-soft ${mode === "slide" ? "" : "flex-1"}`}
    >
      {/* Controls. Two fixed rows: what you do to the view (page, mode,
          close) and which file you are on. Nothing here wraps, moves or
          disappears with the number of open tabs or the mode. */}
      <div className="flex h-11 items-center gap-2 border-b border-line bg-panel px-3">
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
              className="h-7 w-11 rounded-md border border-line-2 bg-panel text-center text-[13px] tabular-nums text-ink [appearance:textfield] focus:border-accent focus:outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            />
            <span className="min-w-[2.75rem]">/ {total ?? "…"}</span>
          </label>
          <button type="button" aria-label="Next page" onClick={() => setPage(tab.page + 1)} disabled={total !== null && tab.page >= total} className="h-[30px] w-[30px] rounded-md border border-line-2 bg-panel text-ink-2 disabled:opacity-40">›</button>
        </div>
        <div className="ml-auto flex shrink-0 gap-0.5 rounded-md bg-sunken p-0.5">
          {([
            ["slide", "Slide", "Slide only"],
            ["split", "Both", "Slide and notes"],
            ["notes", "Notes", "Notes only — the slide collapses"],
          ] as const).map(([m, label, title]) => (
            <button key={m} type="button" title={title} aria-pressed={mode === m} onClick={() => onMode(m)} className={`h-[26px] rounded px-2.5 text-xs font-medium ${mode === m ? "bg-panel text-ink shadow-sm" : "text-ink-2 hover:text-ink"}`}>{label}</button>
          ))}
        </div>
        <button type="button" aria-label="Close viewer" title="Close the slide panel (Esc)" onClick={onClose} className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-md text-lg text-ink-2 hover:bg-ink/[0.06] hover:text-ink">×</button>
      </div>

      <div className="flex h-11 items-center gap-1.5 border-b border-line bg-panel px-3">
        <div role="tablist" aria-label="Open files" className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto [scrollbar-width:none]">
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
        </div>
        <div className="relative shrink-0">
          <button type="button" aria-haspopup="listbox" aria-expanded={picking} onClick={() => setPicking((p) => !p)} className="flex h-[30px] w-[30px] items-center justify-center rounded-full border border-dashed border-line-2 text-base text-ink-2 hover:border-accent hover:text-accent" aria-label="Open another deck">+</button>
          {picking && (
            <ul role="listbox" className="absolute left-0 top-9 z-40 max-h-72 w-[min(16rem,calc(100vw-2rem))] overflow-y-auto rounded-md border border-line bg-panel py-1 shadow-lg">
              {unopened.length === 0 && <li className="px-3 py-2 text-[13px] text-ink-3">Every deck is open</li>}
              {unopened.map((d) => (
                <li key={d}>
                  <button type="button" role="option" aria-selected={false} onClick={() => openDeck(d)} className="block w-full truncate px-3 py-2 text-left text-[13px] text-ink hover:bg-accent-soft">{d}</button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <span aria-hidden className="mx-0.5 h-5 w-px shrink-0 bg-line" />
        <button
          type="button"
          aria-pressed={mode === "slide" && thumbs}
          onClick={() => onThumbs(!thumbs)}
          disabled={mode !== "slide"}
          aria-label="Page thumbnails"
          title={mode !== "slide" ? "Thumbnails show in the Slide view" : thumbs ? "Hide page thumbnails" : "Show page thumbnails"}
          className={`flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-md hover:bg-ink/[0.05] disabled:cursor-not-allowed disabled:text-ink-3 disabled:hover:bg-transparent ${mode === "slide" && thumbs ? "bg-accent-soft text-accent" : "text-ink-2"}`}
        >
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><rect x="3" y="14" width="5" height="6" rx="1" /><rect x="9.5" y="14" width="5" height="6" rx="1" /><rect x="16" y="14" width="5" height="6" rx="1" /><rect x="3" y="4" width="18" height="7" rx="1.5" /></svg>
        </button>
        <a
          href={deckProxyUrl(moduleId, tab.deck, tab.page)}
          target="_blank"
          rel="noreferrer"
          aria-label="Open the full PDF in a new tab"
          title="Open the full PDF in a new tab"
          className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-md text-ink-2 hover:bg-ink/[0.05] hover:text-accent"
        >
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M14 4h6v6" /><path d="M20 4 11 13" /><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" /></svg>
        </a>
      </div>

      {/* Slide + notes */}
      <div className="flex min-h-0 flex-grow flex-col gap-3 overflow-hidden p-3">
        <div hidden={mode === "notes"} className={`relative w-full overflow-hidden rounded-md border border-line bg-panel shadow-sm ${mode === "split" ? "shrink-0" : "min-h-0 flex-grow"}`} style={mode === "split" ? { maxHeight: "42%" } : undefined}>
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
        {mode === "slide" && thumbs && (
          <Filmstrip moduleId={moduleId} deck={tab.deck} page={tab.page} total={total} noted={notedPages} cited={citedPages} onPick={setPage} />
        )}
        {mode !== "slide" && (
          <div className="flex min-h-0 flex-grow flex-col gap-2">
            <div role="tablist" aria-label="Notes" className="flex shrink-0 gap-1">
              {([
                ["slide", "This slide"],
                ["deck", `This deck · ${deckNotes.length}`],
                ["module", `Module · ${notes.length}`],
              ] as const).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  role="tab"
                  aria-selected={scope === k}
                  onClick={() => setScope(k)}
                  className={`h-7 rounded-md px-2.5 text-xs font-medium ${scope === k ? "bg-panel text-ink shadow-sm" : "text-ink-2 hover:text-ink"}`}
                >
                  {label}
                </button>
              ))}
            </div>
            {scope === "slide" && <SlideNote moduleId={moduleId} slide={tab} onSaved={loadNotes} />}
            {scope === "deck" && <NoteList notes={deckNotes} showDeck={false} current={tab} onPick={goTo} empty={`No notes on ${tab.deck} yet.`} />}
            {scope === "module" && <NoteList notes={notes} showDeck current={tab} onPick={goTo} empty="No notes in this module yet." />}
          </div>
        )}
      </div>
    </div>
  );
}

// One note per slide. Loads on slide change, saves 700ms after the last
// keystroke and on blur. A swap to another slide flushes first, so nothing
// typed is lost to the debounce.
function SlideNote({ moduleId, slide, onSaved }: { moduleId: number; slide: SlideRef; onSaved?: () => void }) {
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
      onSaved?.();
      if (latest.current.key === forKey) {
        latest.current.dirty = false;
        setState("saved");
      }
    } catch {
      if (latest.current.key === forKey) setState("error");
    }
  }, [moduleId, onSaved]);

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
        <span className="inline-flex items-center rounded bg-sunken px-2 py-0.5 text-xs font-medium text-ink-2">Note · {slide.deck} · {slide.page}</span>
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

// A strip of page thumbnails centred on the current page. A dot marks pages
// with a note of yours; "cited" marks pages the guide cites. Thumbnails are
// small renders cached on the server, so the strip is cheap after first view.
const STRIP = 7;
function Filmstrip({ moduleId, deck, page, total, noted, cited, onPick }: {
  moduleId: number; deck: string; page: number; total: number | null;
  noted: Set<number>; cited: Set<number>; onPick: (page: number) => void;
}) {
  const last = total ?? page + 3;
  const start = Math.max(1, Math.min(page - Math.floor(STRIP / 2), last - STRIP + 1));
  const pages: number[] = [];
  for (let n = start; n < start + STRIP && n <= last; n++) pages.push(n);
  return (
    <ol aria-label="Pages" className="grid shrink-0 grid-cols-7 gap-1.5">
      {pages.map((n) => {
        const cur = n === page;
        return (
          <li key={n}>
            <button
              type="button"
              onClick={() => onPick(n)}
              aria-current={cur ? "page" : undefined}
              aria-label={`Page ${n}${noted.has(n) ? ", has a note" : ""}${cited.has(n) ? ", cited in the guide" : ""}`}
              className={`relative block aspect-[16/10] w-full overflow-hidden rounded-[3px] bg-panel ${cur ? "ring-2 ring-accent" : "border border-line hover:border-ink-3"}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={slideImageUrl(moduleId, deck, n, "thumb")} alt="" loading="lazy" className="h-full w-full object-contain" />
              <span className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-panel/90 px-1 text-[10px] leading-4 tabular-nums">
                <span className="flex items-center gap-1">
                  {noted.has(n) && <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-warn" />}
                  {cited.has(n) && <><span aria-hidden className="h-1.5 w-1.5 rounded-full bg-accent sm:hidden" /><span className="hidden font-medium text-accent sm:inline">cited</span></>}
                </span>
                <span className={cur ? "font-semibold text-accent" : "text-ink-3"}>{n}</span>
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

const firstLine = (md: string) => md.replace(/!\[[^\]]*\]\([^)]*\)/g, "[image]").replace(/\s+/g, " ").trim();

// Notes as a list — this deck's, or the whole module's grouped by deck.
// Picking one jumps the panel to that slide and back to the editor.
function NoteList({ notes, showDeck, current, onPick, empty }: {
  notes: NoteSummary[]; showDeck: boolean; current: SlideRef;
  onPick: (deck: string, page: number) => void; empty: string;
}) {
  if (notes.length === 0) return <p className="rounded-md border border-dashed border-line-2 px-3 py-6 text-center text-[13px] text-ink-3">{empty}</p>;
  const groups: { deck: string; rows: NoteSummary[] }[] = [];
  for (const n of notes) {
    const g = groups[groups.length - 1];
    if (g && g.deck === n.deck) g.rows.push(n);
    else groups.push({ deck: n.deck, rows: [n] });
  }
  return (
    <div className="min-h-0 flex-grow overflow-y-auto overscroll-contain rounded-md border border-line bg-panel">
      {groups.map((g) => (
        <section key={g.deck}>
          {showDeck && <h3 className="sticky top-0 border-b border-line bg-panel/95 px-3 py-1.5 text-xs font-semibold text-ink-2">{g.deck} <span className="font-normal text-ink-3">· {g.rows.length}</span></h3>}
          <ul className="divide-y divide-line">
            {g.rows.map((n) => {
              const cur = n.deck === current.deck && n.page === current.page;
              return (
                <li key={`${n.deck}#${n.page}`}>
                  <button type="button" onClick={() => onPick(n.deck, n.page)} className={`flex w-full flex-col gap-0.5 px-3 py-2 text-left hover:bg-accent-soft ${cur ? "bg-accent-soft" : ""}`}>
                    <span className="flex items-center justify-between text-xs">
                      <span className="font-medium text-accent tabular-nums">slide {n.page}</span>
                      <span className="text-ink-3">{new Date(n.updatedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>
                    </span>
                    <span className="line-clamp-2 text-[13px] leading-[1.5] text-ink-2">{firstLine(n.markdown)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
