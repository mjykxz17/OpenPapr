"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PapiFace, type Mood } from "./PapiFace";

type Nudges = { reminders: string[]; quips: string[]; smart: boolean };
type Msg = { role: "user" | "assistant"; content: string; at?: number };
type Summary = { id: number; title: string; updatedAt: number; count: number; preview: string };

const SIZES = { S: 44, M: 56, L: 76, XL: 104 } as const;
type SizeKey = keyof typeof SIZES;
const KEYS = { quiet: "papi-quiet", size: "papi-size", pos: "papi-pos", panel: "papi-panel", session: "papi-session" };
const SUGGESTIONS = ["When's my next quiz?", "What's due this week?", "Is anything missing?", "What did lecturers say recently?"];
const PET_LINES = ["hehe", "that tickles", "*happy paper noises*", "again!", "I'm crinkling with joy"];
const DROP_LINES = ["Wheee!", "Nice view from here.", "I like it here.", "Moving day!"];
const DIZZY_LINES = ["Whoa… the room is spinning.", "Gentle! I'm only paper.", "I think I left my stomach over there."];

const rand = (min: number, max: number) => min + Math.random() * (max - min);
const pick = <T,>(a: readonly T[]) => a[Math.floor(Math.random() * a.length)]!;
const asleepNow = () => { const h = new Date(Date.now() + 8 * 3_600_000).getUTCHours(); return h >= 1 && h < 7; };
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

// Papi: a paper study buddy that lives on top of the page. Drag it anywhere,
// pick its size, pat it, double-click it for a trick, shake it (gently).
// It idles on its own, speaks up with reminders and one-liners, sleeps from
// 1 to 7am, and opens a chat — with saved conversations — when clicked.
export function Papi() {
  const [ready, setReady] = useState(false);
  const [mood, setMood] = useState<Mood>("idle");
  const [anim, setAnim] = useState<"" | "hop" | "spin" | "bounce">("");
  const [bubble, setBubble] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"chat" | "history" | "settings">("chat");
  const [quiet, setQuiet] = useState(false);
  const [asleep, setAsleep] = useState(false);
  const [size, setSize] = useState<SizeKey>("M");
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
  // Offsets from the right and bottom edges, so the pet stays put when the
  // window is resized.
  const [pos, setPos] = useState({ right: 24, bottom: 24 });
  const [panel, setPanel] = useState({ w: 380, h: 500 });
  const [vw, setVw] = useState({ w: 1280, h: 800 });

  const said = useRef(new Set<string>());
  const petRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const bubbleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const drag = useRef<{ id: number; sx: number; sy: number; r0: number; b0: number; moved: boolean; lastX: number; lastT: number; flips: number; dir: number } | null>(null);
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const petTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPetLine = useRef(0);

  const px = SIZES[size];
  const petH = Math.round(px * 70 / 64) + 8;

  // --- restore preferences --------------------------------------------------
  useEffect(() => {
    setQuiet(store.get(KEYS.quiet) === "1");
    const s = store.get(KEYS.size) as SizeKey | null;
    if (s && s in SIZES) setSize(s);
    try { const p = JSON.parse(store.get(KEYS.pos) ?? "null"); if (p && typeof p.right === "number") setPos(p); } catch { /* default */ }
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
    const load = () => fetch("/api/pet").then((r) => (r.ok ? r.json() : null)).then((n) => n && setNudges(n)).catch(() => {});
    load();
    const t = setInterval(() => { load(); setAsleep(asleepNow()); }, 10 * 60_000);
    setReady(true);
    return () => { clearInterval(t); window.removeEventListener("resize", onResize); };
  }, []);

  // Keep the pet on screen whatever the window does.
  const safePos = { right: clamp(pos.right, 4, Math.max(4, vw.w - px - 12)), bottom: clamp(pos.bottom, 4, Math.max(4, vw.h - petH - 4)) };

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

  // Unprompted words: a reminder when one is new, else a quip.
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
          if (line) { said.current.add(line); say(line); }
        }
        next(false);
      }, first ? rand(4000, 7000) : rand(60_000, 150_000));
    };
    next(said.current.size === 0);
    return () => { alive = false; clearTimeout(t); };
  }, [nudges, quiet, asleep, open, say]);

  // --- interaction: drag, tap, double-tap, pat, shake -------------------------
  function onPointerDown(e: React.PointerEvent<HTMLButtonElement>) {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { id: e.pointerId, sx: e.clientX, sy: e.clientY, r0: safePos.right, b0: safePos.bottom, moved: false, lastX: e.clientX, lastT: performance.now(), flips: 0, dir: 0 };
  }
  function onPointerMove(e: React.PointerEvent<HTMLButtonElement>) {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
    if (!d.moved && Math.hypot(dx, dy) < 5) return;
    if (!d.moved) { d.moved = true; setDragging(true); setBubble(null); if (asleep) setAsleep(false); setMood("wheee"); }
    setPos({ right: d.r0 - dx, bottom: d.b0 - dy });
    // Lean into the motion; count sharp direction changes to notice shaking.
    const now = performance.now();
    const vx = (e.clientX - d.lastX) / Math.max(1, now - d.lastT);
    setTilt(clamp(vx * 18, -18, 18));
    const dir = Math.sign(vx);
    if (Math.abs(vx) > 1.2 && dir !== 0 && dir !== d.dir) { d.flips++; d.dir = dir; }
    d.lastX = e.clientX; d.lastT = now;
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
      store.set(KEYS.pos, JSON.stringify(safePos));
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
  // Resting the pointer on Papi for a moment counts as a pat.
  function onEnter() {
    if (petTimer.current) clearTimeout(petTimer.current);
    petTimer.current = setTimeout(() => {
      setBlush(1);
      setMood((m) => (m === "idle" || m.startsWith("look") ? "happy" : m));
      if (!open && !bubble && Date.now() - lastPetLine.current > 45_000) { lastPetLine.current = Date.now(); say(pick(PET_LINES), 2200); }
    }, 900);
  }
  function onLeave() {
    if (petTimer.current) clearTimeout(petTimer.current);
    setBlush(0);
    setMood((m) => (m === "happy" ? "idle" : m));
  }
  function onKey(e: React.KeyboardEvent<HTMLButtonElement>) {
    const step = e.shiftKey ? 40 : 12;
    const moves: Record<string, [number, number]> = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    const m = moves[e.key];
    if (!m) return;
    e.preventDefault();
    const next = { right: safePos.right + m[0], bottom: safePos.bottom + m[1] };
    setPos(next);
    store.set(KEYS.pos, JSON.stringify(next));
  }

  function toggleChat() {
    setBubble(null);
    if (asleep && !open) { setAsleep(false); setTimeout(() => setAsleep(asleepNow()), 5 * 60_000); }
    setOpen((o) => !o);
  }

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
      const res = await fetch("/api/pet/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: q, sessionId }) });
      const body = (await res.json().catch(() => null)) as { reply?: string; sessionId?: number } | null;
      setMessages((m) => [...m, { role: "assistant", content: body?.reply ?? "Hmm, I couldn't reach my notes just now. Try again in a moment?", at: Date.now() }]);
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
    if (q) setBubble(null);
  }
  function chooseSize(s: SizeKey) { setSize(s); store.set(KEYS.size, s); setAnim("bounce"); setTimeout(() => setAnim(""), 600); }
  function resetSpot() { const p = { right: 24, bottom: 24 }; setPos(p); store.set(KEYS.pos, JSON.stringify(p)); }

  // Where the panel and bubble go: above the pet if it sits low, below if
  // high; aligned to whichever side has room.
  const petLeft = vw.w - safePos.right - px - 8;
  const petTop = vw.h - safePos.bottom - petH;
  const pw = Math.min(panel.w, vw.w - 16), ph = Math.min(panel.h, vw.h - 24);
  const above = petTop > vw.h / 2;
  const alignRight = petLeft + px / 2 > vw.w / 2;
  const panelLeft = clamp(alignRight ? petLeft + px + 8 - pw : petLeft, 8, vw.w - pw - 8);
  const panelTop = clamp(above ? petTop - ph - 10 : petTop + petH + 10, 8, vw.h - ph - 8);
  const bubbleStyle: React.CSSProperties = above
    ? { bottom: vw.h - petTop + 6, ...(alignRight ? { right: vw.w - (petLeft + px + 8) } : { left: petLeft }) }
    : { top: petTop + petH + 6, ...(alignRight ? { right: vw.w - (petLeft + px + 8) } : { left: petLeft }) };

  // The panel is resized from its far corner (the one away from Papi), and
  // remembers its size.
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
    const next = { w: clamp(r.w0 + (alignRight ? -dx : dx), 300, vw.w - 16), h: clamp(r.h0 + (above ? -dy : dy), 320, vw.h - 24) };
    setPanel(next);
    store.set(KEYS.panel, JSON.stringify(next));
  }
  function onGripUp() { resize.current = null; }

  if (!ready) return null;

  const iconBtn = "flex h-7 items-center justify-center rounded-md px-2 text-[12px] text-ink-2 hover:bg-sunken hover:text-ink";

  return (
    <div className="print:hidden">
      {open && (
        <section ref={panelRef} aria-label="Chat with Papi"
          style={{ left: panelLeft, top: panelTop, width: pw, height: ph }}
          className="fixed z-40 flex flex-col overflow-hidden rounded-[14px] border border-line bg-panel shadow-[0_12px_40px_-12px_rgba(0,0,0,0.28)]">
          {/* resize grip, on the corner away from Papi */}
          <div aria-hidden onPointerDown={onGripDown} onPointerMove={onGripMove} onPointerUp={onGripUp}
            style={{ [above ? "top" : "bottom"]: 0, [alignRight ? "left" : "right"]: 0, cursor: (above === alignRight) ? "nwse-resize" : "nesw-resize", touchAction: "none" }}
            className="absolute z-10 h-4 w-4">
            <svg viewBox="0 0 10 10" width="10" height="10" className="m-[3px] text-ink-3" style={{ transform: `rotate(${above ? (alignRight ? 180 : 270) : (alignRight ? 90 : 0)}deg)` }}>
              <path d="M9 3 L3 9 M9 6 L6 9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
          </div>
          <header className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
            <div className="min-w-0 pl-1">
              <p className="truncate text-[14px] font-semibold text-ink">
                {view === "history" ? "Past chats" : view === "settings" ? "Papi settings" : "Papi"}
              </p>
              {view === "chat" && (
                <p className="truncate text-[11.5px] text-ink-3">{nudges?.smart === false ? "Basic mode · add an AI key for smarter answers" : "Answers from your Canvas, tasks and courses"}</p>
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
              <div>
                <p className="mb-2 text-[12px] font-semibold uppercase tracking-[0.05em] text-ink-2">Size</p>
                <div className="flex gap-1.5" role="radiogroup" aria-label="Papi's size">
                  {(Object.keys(SIZES) as SizeKey[]).map((k) => (
                    <button key={k} type="button" role="radio" aria-checked={size === k} onClick={() => chooseSize(k)}
                      className={`h-9 w-11 rounded-md border text-[13px] ${size === k ? "border-ink text-ink" : "border-line-2 text-ink-2 hover:border-ink-3"}`}>{k}</button>
                  ))}
                </div>
              </div>
              <label className="flex items-center justify-between gap-3">
                <span><span className="text-ink">Speak up on its own</span><br /><span className="text-[12px] text-ink-3">Reminders and one-liners every minute or two</span></span>
                <input type="checkbox" checked={!quiet} onChange={toggleQuiet} className="h-4 w-4 accent-[var(--ink)]" />
              </label>
              <div>
                <p className="mb-1 text-ink">Where Papi sits</p>
                <p className="mb-2 text-[12px] text-ink-3">Drag Papi anywhere, or focus it and use the arrow keys.</p>
                <button type="button" onClick={resetSpot} className="rounded-md border border-line-2 px-3 py-1.5 text-[13px] text-ink hover:border-ink-3">Put back in the corner</button>
              </div>
              <p className="text-[12px] leading-relaxed text-ink-3">Things to try: rest your pointer on Papi, double-click it, or give it a (gentle) shake.</p>
            </div>
          )}

          {view === "chat" && (
            <>
              <div ref={listRef} className="flex flex-1 flex-col gap-2.5 overflow-y-auto px-4 py-3" aria-live="polite">
                {messages.length === 0 && (
                  <div className="flex flex-col gap-2">
                    <p className="text-[14px] leading-[1.5] text-ink-2">Hi! Ask me about dates, quizzes, what&apos;s due, or what a lecturer said. I only know what Canvas told me, so I won&apos;t make things up.</p>
                    <div className="flex flex-wrap gap-1.5">
                      {SUGGESTIONS.map((s) => (
                        <button key={s} type="button" onClick={() => ask(s)} className="rounded-full border border-line px-2.5 py-1 text-[12.5px] text-ink-2 hover:border-ink-3 hover:text-ink">{s}</button>
                      ))}
                    </div>
                  </div>
                )}
                {messages.map((m, i) => (
                  <div key={i} className={m.role === "user" ? "max-w-[85%] self-end rounded-[12px] rounded-br-[4px] bg-ink px-3 py-2 text-[14px] leading-[1.45] text-panel" : "max-w-[92%] self-start whitespace-pre-line text-[14px] leading-[1.55] text-ink"}>
                    {m.content}
                  </div>
                ))}
                {busy && <div className="self-start text-[13px] text-ink-3"><span className="papi-dots">Checking my notes</span></div>}
              </div>
              <form className="flex items-center gap-2 border-t border-line px-3 py-2.5" onSubmit={(e) => { e.preventDefault(); void ask(draft); }}>
                <input ref={inputRef} value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={500} placeholder="When is the next quiz for 4238?"
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

      <button ref={petRef} type="button"
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
        onPointerCancel={() => { drag.current = null; setDragging(false); setTilt(0); }}
        onPointerEnter={onEnter} onPointerLeave={onLeave} onKeyDown={onKey}
        onClick={(e) => { if (e.detail === 0) toggleChat(); /* keyboard Enter/Space */ }}
        aria-label={open ? "Close chat with Papi" : "Papi, your study buddy. Open chat. Arrow keys move it."}
        aria-expanded={open}
        style={{ right: safePos.right, bottom: safePos.bottom, transform: `rotate(${tilt}deg)`, touchAction: "none" }}
        className={`papi fixed z-40 select-none rounded-full p-1 outline-none focus-visible:ring-2 focus-visible:ring-ink-3 ${dragging ? "cursor-grabbing" : "cursor-grab"} ${asleep || dragging ? "" : "papi-bob"}`}>
        <span className={`block ${anim === "hop" ? "papi-hop" : anim === "spin" ? "papi-spin" : anim === "bounce" ? "papi-bounce" : ""}`}>
          <PapiFace mood={open && mood === "sleep" ? "idle" : mood} size={px} gaze={dragging ? null : gaze} blush={blush} />
        </span>
        {asleep && !open && !dragging && <span aria-hidden className="papi-z absolute -top-2 right-0 text-[13px] font-semibold text-ink-3">z<span className="text-[10px]">z</span></span>}
      </button>
    </div>
  );
}
