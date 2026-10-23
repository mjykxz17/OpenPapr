"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter } from "next/navigation";
import { PapiFace, type Mood } from "./PapiFace";
import { answerMessage, isUngrounded, UNGROUNDED_NOTE, type Msg, type Source } from "./chat";
import { bubbleBox, dockBottom, DOCK_ID, isPhone, panelBox, petRect, TAB_ID, WIDE_QUERY, type Rect } from "./placement";
import { noteArrived, noteSeen, noteToSay, noteWaiting, type Note } from "./note";
import { sgtHour } from "@/lib/sgt";

type Nudges = { reminders: string[]; quips: string[]; smart: boolean };

// Anything can open Papi on a question: the guide's "Ask" button sends this.
export const OPEN_ASK = "openpapr:ask";
// Asks the page to show a slide in its slide panel; the guide sets `handled`.
export const SHOW_SLIDE = "openpapr:slide";
export type ShowSlideDetail = { moduleId: number; deck: string; page: number; handled: boolean };
type Summary = { id: number; title: string; updatedAt: number; count: number; preview: string };

// Papi's size in the rail (56px wide) and in a phone's tab bar.
const RAIL_PX = 40;
const TAB_PX = 22;
const KEYS = { quiet: "papi-quiet", dock: "papi-dock", panel: "papi-panel", session: "papi-session" };
const SUGGESTIONS = ["When's my next quiz?", "What's due this week?", "Is anything missing?", "Remind me to … by Friday"];
const PET_LINES = ["hehe", "that tickles", "*happy paper noises*", "again!", "I'm crinkling with joy"];
const DROP_LINES = ["Wheee!", "Nice view from here.", "I like it here.", "Moving day!"];
const DIZZY_LINES = ["Whoa… the room is spinning.", "Gentle! I'm only paper.", "I think I left my stomach over there."];

const rand = (min: number, max: number) => min + Math.random() * (max - min);
const pick = <T,>(a: readonly T[]) => a[Math.floor(Math.random() * a.length)]!;
const asleepNow = () => { const h = sgtHour(Date.now()); return h >= 1 && h < 7; };
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const store = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
  del: (k: string) => { try { localStorage.removeItem(k); } catch { /* private mode */ } },
};
const ago = (ms: number) => {
  const m = Math.round((Date.now() - ms) / 60_000);
  if (m < 1) return "just now"; if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60); if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24); return d < 7 ? `${d}d ago` : new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
};

// Papi: a paper study buddy that lives in the rail, never on the page. Drag
// it up and down the rail, pat it, double-click it for a trick, shake it
// (gently). On a phone it is the Ask tab. It idles on its own, has reminders
// and one-liners (a dot until you come to it), sleeps from 1 to 7am, and
// opens a chat — with saved conversations — when clicked.
export function Papi() {
  const router = useRouter();
  const pathname = usePathname();
  // On a module's pages Papi searches that module's material, unless told to search everything.
  const pageModule = Number(/^\/modules\/(\d+)/.exec(pathname ?? "")?.[1] ?? 0) || null;
  const [everything, setEverything] = useState(false);
  const scope = everything ? null : pageModule;
  const [ready, setReady] = useState(false);
  const [mood, setMood] = useState<Mood>("idle");
  const [anim, setAnim] = useState<"" | "hop" | "spin" | "bounce">("");
  const [bubble, setBubble] = useState<string | null>(null);
  // A line Papi came up with on its own, waiting as a dot (see note.ts).
  const [note, setNote] = useState<Note>(null);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"chat" | "history" | "settings">("chat");
  const [quiet, setQuiet] = useState(false);
  const [asleep, setAsleep] = useState(false);
  const [nudges, setNudges] = useState<Nudges | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [sessions, setSessions] = useState<Summary[] | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [tilt, setTilt] = useState(0);
  const [gaze, setGaze] = useState<{ x: number; y: number } | null>(null);
  const [blush, setBlush] = useState(0);
  // How far up the rail Papi sits, from the bottom of its dock, so it stays
  // put when the window is resized.
  const [dockY, setDockY] = useState(0);
  const [panel, setPanel] = useState({ w: 380, h: 500 });
  const [vw, setVw] = useState({ w: 1280, h: 800 });
  const [phone, setPhone] = useState(false);
  // The rail's spot for Papi (or the phone's tab), and where it is on screen.
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const [slotRect, setSlotRect] = useState<Rect>({ left: 0, top: 0, width: 0, height: 0 });

  const said = useRef(new Set<string>());
  const petRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const bubbleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const drag = useRef<{ id: number; sx: number; sy: number; b0: number; moved: boolean; lastX: number; lastY: number; lastT: number; flips: number; dir: number } | null>(null);
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const petTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPetLine = useRef(0);

  const px = phone ? TAB_PX : RAIL_PX;
  const petW = px + 8;
  const petH = Math.round(px * 70 / 64) + 8;

  // --- restore preferences --------------------------------------------------
  useEffect(() => {
    setQuiet(store.get(KEYS.quiet) === "1");
    setDockY(Number(store.get(KEYS.dock)) || 0);
    // Left over from when Papi floated over the page and came in sizes.
    store.del("papi-pos"); store.del("papi-size");
    try { const p = JSON.parse(store.get(KEYS.panel) ?? "null"); if (p && typeof p.w === "number") setPanel(p); } catch { /* default */ }
    const sid = Number(store.get(KEYS.session));
    if (sid) {
      fetch(`/api/pet/sessions/${sid}`).then((r) => (r.ok ? r.json() : null)).then((c) => {
        if (c?.messages) { setSessionId(c.id); setMessages(c.messages); } else store.del(KEYS.session);
      }).catch(() => {});
    }
    setAsleep(asleepNow());
    const onResize = () => setVw({ w: window.innerWidth, h: window.innerHeight });
    onResize();
    window.addEventListener("resize", onResize);
    // Phone or not is the rail's own media query, so Papi always lands in the
    // slot that is actually showing.
    const wide = window.matchMedia(WIDE_QUERY);
    const onWide = () => setPhone(isPhone((q) => window.matchMedia(q)));
    onWide();
    wide.addEventListener("change", onWide);
    const load = () => fetch("/api/pet").then((r) => (r.ok ? r.json() : null)).then((n) => n && setNudges(n)).catch(() => {});
    load();
    const t = setInterval(() => { load(); setAsleep(asleepNow()); }, 10 * 60_000);
    setReady(true);
    return () => { clearInterval(t); window.removeEventListener("resize", onResize); wide.removeEventListener("change", onWide); };
  }, []);

  // Find the spot the rail (or the tab bar, on a phone) keeps for Papi, and
  // follow it as the window changes.
  useEffect(() => {
    if (!ready) return;
    const el = document.getElementById(phone ? TAB_ID : DOCK_ID);
    setSlot(el);
    if (!el) return;
    const measure = () => { const r = el.getBoundingClientRect(); setSlotRect({ left: r.left, top: r.top, width: r.width, height: r.height }); };
    measure();
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [ready, phone, vw]);

  const safeBottom = dockBottom(dockY, slotRect.height, petH);
  const pet = petRect(phone, slotRect, safeBottom, petW, petH);

  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" }); }, [messages, busy, open, view]);
  useEffect(() => { if (open && view === "chat") setTimeout(() => inputRef.current?.focus(), 50); }, [open, view]);

  // --- idle life -----------------------------------------------------------
  useEffect(() => {
    if (asleep) { setMood("sleep"); return; }
    let alive = true;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const every = (min: number, max: number, fn: () => void) => {
      const tick = () => { if (!alive) return; fn(); timers.push(setTimeout(tick, rand(min, max))); };
      timers.push(setTimeout(tick, rand(min, max)));
    };
    const flash = (m: Mood, ms: number) => { setMood((cur) => (cur === "idle" ? m : cur)); timers.push(setTimeout(() => setMood((cur) => (cur === m ? "idle" : cur)), ms)); };
    every(2800, 6500, () => flash("blink", 160));
    every(9000, 20000, () => flash(Math.random() < 0.5 ? "look-left" : "look-right", 1400));
    every(25000, 55000, () => { setAnim("hop"); flash("happy", 700); timers.push(setTimeout(() => setAnim(""), 700)); });
    setMood("idle");
    return () => { alive = false; timers.forEach(clearTimeout); };
  }, [asleep]);

  // Eyes follow the pointer when it is near.
  useEffect(() => {
    if (asleep) { setGaze(null); return; }
    let raf = 0;
    const onMove = (e: PointerEvent) => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const r = petRef.current?.getBoundingClientRect();
        if (!r) return;
        const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height * 0.42);
        const d = Math.hypot(dx, dy);
        setGaze(d > 420 ? null : { x: clamp(dx / 160, -1, 1), y: clamp(dy / 160, -1, 1) });
      });
    };
    window.addEventListener("pointermove", onMove);
    return () => { window.removeEventListener("pointermove", onMove); if (raf) cancelAnimationFrame(raf); };
  }, [asleep]);

  const say = useCallback((text: string, ms = 8000) => {
    if (bubbleTimer.current) clearTimeout(bubbleTimer.current);
    setBubble(text);
    setMood((m) => (m === "sleep" || m === "dizzy" ? m : "talk"));
    setTimeout(() => setMood((m) => (m === "talk" ? "idle" : m)), 1400);
    bubbleTimer.current = setTimeout(() => setBubble(null), ms);
  }, []);

  // Unprompted words: a reminder when one is new, else a quip. A bubble
  // would cover the page, so it waits as a dot on Papi instead.
  const hint = useCallback((text: string) => {
    setNote(noteArrived(text));
    setMood((m) => (m === "sleep" || m === "dizzy" ? m : "talk"));
    setTimeout(() => setMood((m) => (m === "talk" ? "idle" : m)), 1400);
  }, []);
  // The waiting line, as a bubble, once the pointer or focus reaches Papi.
  function sayNote(): boolean {
    const line = noteToSay(note);
    // A phone has no hover, and a tap opens the chat, which shows the line.
    if (!line || open || phone) return false;
    setNote(noteSeen);
    say(line);
    return true;
  }
  useEffect(() => {
    if (!nudges || quiet || asleep || open) return;
    let alive = true;
    let t: ReturnType<typeof setTimeout>;
    const next = (first: boolean) => {
      t = setTimeout(() => {
        if (!alive) return;
        if (document.visibilityState === "visible" && !drag.current) {
          const fresh = nudges.reminders.filter((r) => !said.current.has(r));
          const line = fresh.length && (first || Math.random() < 0.55) ? fresh[0] : pick(nudges.quips);
          if (line) { said.current.add(line); hint(line); }
        }
        next(false);
      }, first ? rand(4000, 7000) : rand(60_000, 150_000));
    };
    next(said.current.size === 0);
    return () => { alive = false; clearTimeout(t); };
  }, [nudges, quiet, asleep, open, hint]);

  // --- interaction: drag, tap, double-tap, pat, shake -------------------------
  function onPointerDown(e: React.PointerEvent<HTMLButtonElement>) {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { id: e.pointerId, sx: e.clientX, sy: e.clientY, b0: safeBottom, moved: false, lastX: e.clientX, lastY: e.clientY, lastT: performance.now(), flips: 0, dir: 0 };
  }
  function onPointerMove(e: React.PointerEvent<HTMLButtonElement>) {
    const d = drag.current;
    // On a phone Papi is a tab: it can be tapped, not moved.
    if (!d || d.id !== e.pointerId || phone) return;
    const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
    if (!d.moved && Math.hypot(dx, dy) < 5) return;
    if (!d.moved) { d.moved = true; setDragging(true); setBubble(null); if (asleep) setAsleep(false); setMood("wheee"); }
    // It slides along the rail only, so it never lands on the page.
    setDockY(dockBottom(d.b0 - dy, slotRect.height, petH));
    // Lean into sideways pulls; count sharp up-and-down turns to notice shaking.
    const now = performance.now();
    const dt = Math.max(1, now - d.lastT);
    const vx = (e.clientX - d.lastX) / dt, vy = (e.clientY - d.lastY) / dt;
    setTilt(clamp(vx * 18, -18, 18));
    const dir = Math.sign(vy);
    if (Math.abs(vy) > 1.2 && dir !== 0 && dir !== d.dir) { d.flips++; d.dir = dir; }
    d.lastX = e.clientX; d.lastY = e.clientY; d.lastT = now;
  }
  function onPointerUp(e: React.PointerEvent<HTMLButtonElement>) {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    if (d.moved) {
      setDragging(false);
      setTilt(0);
      setAnim("bounce");
      setTimeout(() => setAnim(""), 600);
      store.set(KEYS.dock, String(safeBottom));
      if (d.flips >= 6) { setMood("dizzy"); if (!open) say(pick(DIZZY_LINES), 3500); setTimeout(() => setMood((m) => (m === "dizzy" ? "idle" : m)), 2600); }
      else { setMood("happy"); setTimeout(() => setMood((m) => (m === "happy" ? "idle" : m)), 800); if (!open && Math.random() < 0.35) say(pick(DROP_LINES), 2500); }
      return;
    }
    // A tap opens the chat; a second tap soon after is a trick instead.
    if (tapTimer.current) {
      clearTimeout(tapTimer.current);
      tapTimer.current = null;
      trick();
      return;
    }
    tapTimer.current = setTimeout(() => { tapTimer.current = null; toggleChat(); }, 240);
  }
  function trick() {
    setAnim("spin");
    setMood("happy");
    setTimeout(() => { setAnim(""); setMood((m) => (m === "happy" ? "idle" : m)); }, 900);
    if (nudges && !open) say(pick(nudges.quips), 5000);
  }
  // Resting the pointer on Papi for a moment counts as a pat. Reaching it at
  // all is when it says what it has been waiting to say.
  function onEnter() {
    const spoke = sayNote();
    if (petTimer.current) clearTimeout(petTimer.current);
    petTimer.current = setTimeout(() => {
      setBlush(1);
      setMood((m) => (m === "idle" || m.startsWith("look") ? "happy" : m));
      if (!open && !bubble && !spoke &&Date.now() - lastPetLine.current > 45_000) { lastPetLine.current = Date.now(); say(pick(PET_LINES), 2200); }
    }, 900);
  }
  function onLeave() {
    if (petTimer.current) clearTimeout(petTimer.current);
    setBlush(0);
    setMood((m) => (m === "happy" ? "idle" : m));
  }
  function onKey(e: React.KeyboardEvent<HTMLButtonElement>) {
    if (phone || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
    e.preventDefault();
    const step = (e.shiftKey ? 40 : 12) * (e.key === "ArrowUp" ? 1 : -1);
    const next = dockBottom(safeBottom + step, slotRect.height, petH);
    setDockY(next);
    store.set(KEYS.dock, String(next));
  }

  // Opening the chat hands it the waiting line, as Papi's latest message.
  useEffect(() => {
    if (!open || !note) return;
    setMessages((m) => [...m, { role: "assistant", content: note.text, at: Date.now() }]);
    setNote(null);
  }, [open, note]);

  function toggleChat() {
    setBubble(null);
    if (asleep && !open) { setAsleep(false); setTimeout(() => setAsleep(asleepNow()), 5 * 60_000); }
    setOpen((o) => !o);
  }

  // A cited source: a slide opens in the guide's slide panel when the guide
  // is on screen, otherwise the guide opens at that slide.
  const openSource = useCallback((src: Source) => {
    if (src.slide) {
      const detail: ShowSlideDetail = { moduleId: src.moduleId, deck: src.slide.deck, page: src.slide.page, handled: false };
      window.dispatchEvent(new CustomEvent(SHOW_SLIDE, { detail }));
      if (detail.handled) return;
    }
    router.push(src.href);
  }, [router]);

  useEffect(() => {
    const onAsk = (e: Event) => {
      const d = (e as CustomEvent<{ prompt?: string } | undefined>).detail;
      setEverything(false);
      setOpen(true);
      setView("chat");
      if (d?.prompt) setDraft(d.prompt);
    };
    window.addEventListener(OPEN_ASK, onAsk);
    return () => window.removeEventListener(OPEN_ASK, onAsk);
  }, []);

  // --- chat and sessions ------------------------------------------------------
  async function ask(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    setView("chat");
    setMessages((m) => [...m, { role: "user", content: q, at: Date.now() }]);
    setDraft("");
    setBusy(true);
    setMood("think");
    try {
      const res = await fetch("/api/pet/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: q, sessionId, moduleId: scope }) });
      const body = (await res.json().catch(() => null)) as { reply?: string; sessionId?: number; added?: boolean; sources?: Source[]; grounded?: boolean } | null;
      if (body?.added) router.refresh();
      setMessages((m) => [...m, answerMessage(body, Date.now())]);
      if (body?.sessionId) { setSessionId(body.sessionId); store.set(KEYS.session, String(body.sessionId)); setSessions(null); }
    } catch {
      setMessages((m) => [...m, { role: "assistant", content: "I lost the connection for a second there. Try again?" }]);
    } finally {
      setBusy(false);
      setMood("happy");
      setTimeout(() => setMood((m) => (m === "happy" ? "idle" : m)), 900);
    }
  }
  function newChat() {
    setSessionId(null);
    setMessages([]);
    store.del(KEYS.session);
    setView("chat");
  }
  async function showHistory() {
    setView("history");
    try { const r = await fetch("/api/pet/sessions"); if (r.ok) setSessions((await r.json()).sessions ?? []); } catch { setSessions([]); }
  }
  async function openSession(id: number) {
    try {
      const r = await fetch(`/api/pet/sessions/${id}`);
      if (!r.ok) return;
      const c = await r.json();
      setSessionId(c.id); setMessages(c.messages ?? []); store.set(KEYS.session, String(c.id)); setView("chat");
    } catch { /* stay on the list */ }
  }
  async function removeSession(id: number) {
    setSessions((s) => (s ?? []).filter((x) => x.id !== id));
    if (id === sessionId) newChat();
    await fetch(`/api/pet/sessions/${id}`, { method: "DELETE" }).catch(() => {});
  }

  function toggleQuiet() {
    const q = !quiet;
    setQuiet(q);
    store.set(KEYS.quiet, q ? "1" : "0");
    if (q) { setBubble(null); setNote(null); }
  }
  function resetSpot() { setDockY(0); store.set(KEYS.dock, "0"); setAnim("bounce"); setTimeout(() => setAnim(""), 600); }

  // The chat opens beside the rail (a sheet above the tab bar on a phone),
  // and the bubble next to Papi.
  const box = panelBox(phone, pet, vw, panel);
  const pw = box.width, ph = box.height;
  const bubbleStyle: React.CSSProperties = bubbleBox(phone, pet, vw);

  // The panel grows up and to the right of Papi, so it is resized from its
  // top-right corner, and remembers its size.
  const resize = useRef<{ id: number; sx: number; sy: number; w0: number; h0: number } | null>(null);
  function onGripDown(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    resize.current = { id: e.pointerId, sx: e.clientX, sy: e.clientY, w0: pw, h0: ph };
  }
  function onGripMove(e: React.PointerEvent<HTMLDivElement>) {
    const r = resize.current;
    if (!r || r.id !== e.pointerId) return;
    const dx = e.clientX - r.sx, dy = e.clientY - r.sy;
    const next = { w: clamp(r.w0 + dx, 300, vw.w - 16), h: clamp(r.h0 - dy, 320, vw.h - 16) };
    setPanel(next);
    store.set(KEYS.panel, JSON.stringify(next));
  }
  function onGripUp() { resize.current = null; }

  if (!ready) return null;
  const waiting = noteWaiting(note) && !open && !dragging;

  const iconBtn = "flex h-7 items-center justify-center rounded-md px-2 text-[12px] text-ink-2 hover:bg-sunken hover:text-ink";

  return (
    <div className="print:hidden">
      {open && (
        <section ref={panelRef} aria-label="Chat with Papi"
          style={{ left: box.left, top: box.top, width: pw, height: ph }}
          className="fixed z-40 flex flex-col overflow-hidden rounded-[14px] border border-line bg-panel shadow-[0_12px_40px_-12px_rgba(0,0,0,0.28)]">
          {/* resize grip, on the corner away from Papi */}
          {!phone && <div aria-hidden onPointerDown={onGripDown} onPointerMove={onGripMove} onPointerUp={onGripUp}
            style={{ top: 0, right: 0, cursor: "nesw-resize", touchAction: "none" }}
            className="absolute z-10 h-4 w-4">
            <svg viewBox="0 0 10 10" width="10" height="10" className="m-[3px] text-ink-3" style={{ transform: "rotate(270deg)" }}>
              <path d="M9 3 L3 9 M9 6 L6 9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
          </div>}
          <header className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
            <div className="min-w-0 pl-1">
              <p className="truncate text-[14px] font-semibold text-ink">
                {view === "history" ? "Past chats" : view === "settings" ? "Papi settings" : "Papi"}
              </p>
              {view === "chat" && (
                <p className="truncate text-[11.5px] text-ink-3">{nudges?.smart === false ? "Basic mode · add an AI key for smarter answers" : "Answers from your own material, with sources"}</p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-0.5">
              {view !== "chat" ? (
                <button type="button" onClick={() => setView("chat")} className={iconBtn}>Back</button>
              ) : (
                <>
                  <button type="button" onClick={newChat} className={iconBtn} title="Start a new conversation">New</button>
                  <button type="button" onClick={showHistory} className={iconBtn} title="Past conversations">History</button>
                  <button type="button" onClick={() => setView("settings")} className={iconBtn} aria-label="Papi settings" title="Size and behaviour">
                    <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden><circle cx="3" cy="8" r="1.4" /><circle cx="8" cy="8" r="1.4" /><circle cx="13" cy="8" r="1.4" /></svg>
                  </button>
                </>
              )}
              <button type="button" onClick={() => setOpen(false)} aria-label="Close chat" className={iconBtn}>
                <svg viewBox="0 0 16 16" width="12" height="12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden><path d="M3 3l10 10M13 3L3 13" /></svg>
              </button>
            </div>
          </header>

          {view === "history" && (
            <div className="flex-1 overflow-y-auto p-2">
              {sessions === null ? <p className="p-3 text-[13px] text-ink-3">Loading…</p>
                : sessions.length === 0 ? <p className="p-3 text-[13px] text-ink-3">No conversations yet.</p>
                : (
                  <ul className="flex flex-col">
                    {sessions.map((s) => (
                      <li key={s.id} className={`group flex items-start gap-2 rounded-md px-2.5 py-2 hover:bg-sunken ${s.id === sessionId ? "bg-sunken" : ""}`}>
                        <button type="button" onClick={() => openSession(s.id)} className="min-w-0 flex-1 text-left">
                          <p className="truncate text-[13.5px] font-medium text-ink">{s.title}</p>
                          <p className="truncate text-[12px] text-ink-3">{ago(s.updatedAt)} · {Math.ceil(s.count / 2)} question{s.count > 2 ? "s" : ""}{s.preview ? ` · ${s.preview}` : ""}</p>
                        </button>
                        <button type="button" onClick={() => removeSession(s.id)} aria-label={`Delete “${s.title}”`}
                          className="shrink-0 rounded px-1.5 text-[12px] text-ink-3 opacity-0 hover:text-danger focus:opacity-100 group-hover:opacity-100">Delete</button>
                      </li>
                    ))}
                  </ul>
                )}
            </div>
          )}

          {view === "settings" && (
            <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-4 py-4 text-[13.5px]">
              <label className="flex items-center justify-between gap-3">
                <span><span className="text-ink">Speak up on its own</span><br /><span className="text-[12px] text-ink-3">Reminders and one-liners every minute or two, shown as a dot on Papi</span></span>
                <input type="checkbox" checked={!quiet} onChange={toggleQuiet} className="h-4 w-4 accent-[var(--ink)]" />
              </label>
              {!phone && (
                <div>
                  <p className="mb-1 text-ink">Where Papi sits</p>
                  <p className="mb-2 text-[12px] text-ink-3">Drag Papi up or down the left rail, or focus it and use the arrow keys.</p>
                  <button type="button" onClick={resetSpot} className="rounded-md border border-line-2 px-3 py-1.5 text-[13px] text-ink hover:border-ink-3">Put back at the bottom</button>
                </div>
              )}
              <p className="text-[12px] leading-relaxed text-ink-3">{phone ? "Things to try: tap Papi twice, quickly." : "Things to try: rest your pointer on Papi, double-click it, or give it a (gentle) shake."}</p>
            </div>
          )}

          {view === "chat" && (
            <>
              <div ref={listRef} className="flex flex-1 flex-col gap-2.5 overflow-y-auto px-4 py-3" aria-live="polite">
                {!messages.some((m) => m.role === "user") && (
                  <div className="flex flex-col gap-2">
                    <p className="text-[14px] leading-[1.5] text-ink-2">Hi! Ask me what&apos;s due, or anything about your slides, guides and announcements. I answer from your own material and show where each answer came from. Say “remind me to …” and I&apos;ll add a task.</p>
                    <div className="flex flex-wrap gap-1.5">
                      {SUGGESTIONS.map((s) => (
                        <button key={s} type="button" onClick={() => (s.includes("…") ? setDraft("Remind me to ") : ask(s))} className="rounded-full border border-line px-2.5 py-1 text-[12.5px] text-ink-2 hover:border-ink-3 hover:text-ink">{s}</button>
                      ))}
                    </div>
                  </div>
                )}
                {messages.map((m, i) => (
                  <div key={i} className={m.role === "user" ? "max-w-[85%] self-end rounded-[12px] rounded-br-[4px] bg-ink px-3 py-2 text-[14px] leading-[1.45] text-panel" : "max-w-[92%] self-start whitespace-pre-line text-[14px] leading-[1.55] text-ink"}>
                    {m.role === "assistant" && m.sources?.length ? <Cited text={m.content} sources={m.sources} onOpen={openSource} /> : m.content}
                    {isUngrounded(m) && <p className="mt-1.5 text-[12px] leading-snug text-ink-3">{UNGROUNDED_NOTE}</p>}
                    {m.role === "assistant" && m.sources && m.sources.length > 0 && (
                      <ol className="mt-2 flex flex-col gap-1 border-t border-line pt-2 text-[12.5px] leading-snug">
                        {m.sources.map((src) => (
                          <li key={src.n}>
                            <button type="button" onClick={() => openSource(src)} className="flex w-full items-baseline gap-1.5 text-left text-ink-2 hover:text-accent">
                              <span className="shrink-0 rounded bg-accent-soft px-1 text-[11px] font-semibold tabular-nums text-accent">{src.n}</span>
                              <span className="min-w-0 truncate">{src.code ? `${src.code} · ` : ""}{src.title}</span>
                            </button>
                          </li>
                        ))}
                      </ol>
                    )}
                  </div>
                ))}
                {busy && <div className="self-start text-[13px] text-ink-3"><span className="papi-dots">Checking my notes</span></div>}
              </div>
              {pageModule && (
                <div className="flex items-center gap-2 border-t border-line px-3 pt-2 text-[12px] text-ink-3">
                  <span>Searching</span>
                  <div role="group" aria-label="Which material to search" className="flex rounded-full border border-line p-0.5">
                    <button type="button" aria-pressed={!everything} onClick={() => setEverything(false)} className={`rounded-full px-2 py-0.5 ${!everything ? "bg-ink text-panel" : "hover:text-ink"}`}>this module</button>
                    <button type="button" aria-pressed={everything} onClick={() => setEverything(true)} className={`rounded-full px-2 py-0.5 ${everything ? "bg-ink text-panel" : "hover:text-ink"}`}>everything</button>
                  </div>
                </div>
              )}
              <form className={`flex items-center gap-2 px-3 py-2.5 ${pageModule ? "" : "border-t border-line"}`} onSubmit={(e) => { e.preventDefault(); void ask(draft); }}>
                <input ref={inputRef} value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={500} placeholder={pageModule && !everything ? "Ask about this module…" : "When is the next quiz for 4238?"}
                  className="h-9 min-w-0 flex-1 rounded-md border border-line-2 bg-surface px-3 text-[14px] text-ink outline-none placeholder:text-ink-3 focus:border-ink-3" />
                <button type="submit" disabled={busy || !draft.trim()} className="h-9 rounded-md bg-ink px-3 text-[13px] font-medium text-panel disabled:opacity-40">Ask</button>
              </form>
            </>
          )}
        </section>
      )}

      {bubble && !open && !dragging && (
        <button type="button" onClick={() => { setBubble(null); setOpen(true); }} style={bubbleStyle}
          className="papi-pop fixed z-40 max-w-[260px] rounded-[12px] border border-line bg-panel px-3 py-2 text-left text-[13.5px] leading-[1.45] text-ink shadow-[0_6px_24px_-10px_rgba(0,0,0,0.25)]"
          aria-live="polite">
          {bubble}
        </button>
      )}

      {/* Papi itself lives in the rail (or the tab bar), drawn into the spot
          it keeps, so it is in the rail's tab order and never on the page. */}
      {slot && createPortal(
        <button ref={petRef} type="button"
          onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
          onPointerCancel={() => { drag.current = null; setDragging(false); setTilt(0); }}
          onPointerEnter={onEnter} onPointerLeave={onLeave} onKeyDown={onKey}
          onClick={(e) => { if (e.detail === 0) toggleChat(); /* keyboard Enter/Space */ }}
          title={phone ? undefined : "Ask Papi"}
          aria-label={phone ? undefined : open ? "Close chat with Papi" : `Ask Papi, your study buddy.${waiting ? " Papi has something to tell you." : ""} Arrow keys move it up and down.`}
          onFocus={() => { sayNote(); }}
          aria-expanded={open}
          style={phone ? { touchAction: "manipulation" } : { bottom: safeBottom, transform: `translateX(-50%) rotate(${tilt}deg)`, touchAction: "none" }}
          className={phone
            ? `papi relative flex h-full w-full select-none flex-col items-center justify-center gap-0.5 text-[11px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-ink-3 ${open ? "text-accent" : "text-ink-3"}`
            : `papi absolute left-1/2 select-none rounded-full p-1 outline-none focus-visible:ring-2 focus-visible:ring-ink-3 ${dragging ? "cursor-grabbing" : "cursor-grab"}`}>
          <span className={`relative block ${asleep || dragging ? "" : "papi-bob"}`}>
            <span className={`block ${anim === "hop" ? "papi-hop" : anim === "spin" ? "papi-spin" : anim === "bounce" ? "papi-bounce" : ""}`}>
              <PapiFace mood={open && mood === "sleep" ? "idle" : mood} size={px} gaze={dragging ? null : gaze} blush={blush} />
            </span>
            {asleep && !open && !dragging && <span aria-hidden className="papi-z absolute -top-2 -right-1 text-[13px] font-semibold text-ink-3">z<span className="text-[10px]">z</span></span>}
            {waiting && <span aria-hidden className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-accent ring-2 ring-surface" />}
          </span>
          {phone && <span>{open ? "Close" : "Ask"}{waiting && <span className="sr-only"> (Papi has something to tell you)</span>}</span>}
        </button>,
        slot,
      )}
    </div>
  );
}

// An answer with its [n] citations turned into small buttons that open the source.
function Cited({ text, sources, onOpen }: { text: string; sources: Source[]; onOpen: (s: Source) => void }) {
  const byN = new Map(sources.map((s) => [s.n, s]));
  const parts = text.split(/(\[\d+\])/g);
  return (
    <>
      {parts.map((p, i) => {
        const m = /^\[(\d+)\]$/.exec(p);
        const src = m ? byN.get(Number(m[1])) : undefined;
        if (!src) return <span key={i}>{p}</span>;
        return (
          <button key={i} type="button" onClick={() => onOpen(src)} title={`${src.code ? `${src.code} · ` : ""}${src.title}`}
            className="mx-0.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded bg-accent-soft px-1 align-[1px] text-[11px] font-semibold tabular-nums text-accent hover:bg-accent hover:text-on-accent">
            {src.n}
          </button>
        );
      })}
    </>
  );
}
