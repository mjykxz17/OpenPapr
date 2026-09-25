"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PapiFace, type Mood } from "./PapiFace";

type Nudges = { reminders: string[]; quips: string[]; smart: boolean };
type Msg = { role: "user" | "assistant"; content: string };

const QUIET_KEY = "papi-quiet";
const CHAT_KEY = "papi-chat";
const SUGGESTIONS = ["When's my next quiz?", "What's due this week?", "Is anything missing?", "What did lecturers say recently?"];

const rand = (min: number, max: number) => min + Math.random() * (max - min);
const sgtHour = () => new Date(Date.now() + 8 * 3_600_000).getUTCHours();
const asleepNow = () => { const h = sgtHour(); return h >= 1 && h < 7; };
const store = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
  sget: (k: string) => { try { return sessionStorage.getItem(k); } catch { return null; } },
  sset: (k: string, v: string) => { try { sessionStorage.setItem(k, v); } catch { /* private mode */ } },
};

// The pet at the bottom of every page. It idles (bobs, blinks, looks around,
// hops now and then), says something every minute or two — a real reminder
// when there is one, otherwise a one-liner — and sleeps from 1 to 7am.
// Clicking it opens a chat that answers from the student's own Canvas data.
export function Papi() {
  const [mood, setMood] = useState<Mood>("idle");
  const [hop, setHop] = useState(false);
  const [bubble, setBubble] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [quiet, setQuiet] = useState(false);
  const [asleep, setAsleep] = useState(false);
  const [nudges, setNudges] = useState<Nudges | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const said = useRef(new Set<string>());
  const listRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const bubbleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setQuiet(store.get(QUIET_KEY) === "1");
    setAsleep(asleepNow());
    try { const m = JSON.parse(store.sget(CHAT_KEY) ?? "[]"); if (Array.isArray(m)) setMessages(m.slice(-20)); } catch { /* fresh */ }
    const load = () => fetch("/api/pet").then((r) => (r.ok ? r.json() : null)).then((n) => n && setNudges(n)).catch(() => {});
    load();
    const t = setInterval(() => { load(); setAsleep(asleepNow()); }, 10 * 60_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => { store.sset(CHAT_KEY, JSON.stringify(messages.slice(-20))); }, [messages]);
  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" }); }, [messages, busy, open]);
  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 50); }, [open]);

  // Idle life: blinks, glances and the odd hop, each on its own clock.
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
    every(25000, 55000, () => { setHop(true); flash("happy", 700); timers.push(setTimeout(() => setHop(false), 700)); });
    setMood("idle");
    return () => { alive = false; timers.forEach(clearTimeout); };
  }, [asleep]);

  const say = useCallback((text: string, ms = 8000) => {
    if (bubbleTimer.current) clearTimeout(bubbleTimer.current);
    setBubble(text);
    setMood("talk");
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
        if (document.visibilityState === "visible") {
          const fresh = nudges.reminders.filter((r) => !said.current.has(r));
          const pick = fresh.length && (first || Math.random() < 0.55)
            ? fresh[0]
            : nudges.quips[Math.floor(Math.random() * nudges.quips.length)];
          if (pick) { said.current.add(pick); say(pick); }
        }
        next(false);
      }, first ? rand(4000, 7000) : rand(60_000, 150_000));
    };
    next(said.current.size === 0);
    return () => { alive = false; clearTimeout(t); };
  }, [nudges, quiet, asleep, open, say]);

  async function ask(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    const convo: Msg[] = [...messages, { role: "user", content: q }];
    setMessages(convo);
    setDraft("");
    setBusy(true);
    setMood("think");
    try {
      const res = await fetch("/api/pet/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: convo.slice(-8) }) });
      const body = (await res.json().catch(() => null)) as { reply?: string } | null;
      setMessages([...convo, { role: "assistant", content: body?.reply ?? "Hmm, I couldn't reach my notes just now. Try again in a moment?" }]);
    } catch {
      setMessages([...convo, { role: "assistant", content: "I lost the connection for a second there. Try again?" }]);
    } finally {
      setBusy(false);
      setMood("happy");
      setTimeout(() => setMood((m) => (m === "happy" ? "idle" : m)), 900);
    }
  }

  function toggleQuiet() {
    const q = !quiet;
    setQuiet(q);
    store.set(QUIET_KEY, q ? "1" : "0");
    if (q) setBubble(null);
  }

  function poke() {
    setBubble(null);
    if (asleep && !open) { setAsleep(false); setTimeout(() => setAsleep(asleepNow()), 5 * 60_000); }
    setOpen((o) => !o);
  }

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-40 flex flex-col items-end gap-2 print:hidden sm:bottom-6 sm:right-6">
      {open && (
        <section aria-label="Chat with Papi" className="pointer-events-auto flex h-[min(480px,70vh)] w-[min(360px,calc(100vw-2rem))] flex-col overflow-hidden rounded-[14px] border border-line bg-panel shadow-[0_12px_40px_-12px_rgba(0,0,0,0.25)]">
          <header className="flex items-center justify-between gap-2 border-b border-line px-4 py-2.5">
            <div className="min-w-0">
              <p className="text-[14px] font-semibold text-ink">Papi</p>
              <p className="truncate text-[11.5px] text-ink-3">{nudges?.smart === false ? "Basic mode · add an AI key for smarter answers" : "Answers from your Canvas, tasks and courses"}</p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button type="button" onClick={toggleQuiet} className="rounded-md px-2 py-1 text-[12px] text-ink-2 hover:bg-sunken" aria-pressed={quiet}>
                {quiet ? "Let me talk" : "Shh"}
              </button>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close chat" className="flex h-7 w-7 items-center justify-center rounded-md text-ink-2 hover:bg-sunken">
                <svg viewBox="0 0 16 16" width="12" height="12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden><path d="M3 3l10 10M13 3L3 13" /></svg>
              </button>
            </div>
          </header>
          <div ref={listRef} className="flex flex-1 flex-col gap-2.5 overflow-y-auto px-4 py-3" aria-live="polite">
            {messages.length === 0 && (
              <div className="flex flex-col gap-2">
                <p className="text-[14px] leading-[1.5] text-ink-2">Hi! Ask me about dates, quizzes, what's due, or what a lecturer said. I only know what Canvas told me, so I won't make things up.</p>
                <div className="flex flex-wrap gap-1.5">
                  {SUGGESTIONS.map((s) => (
                    <button key={s} type="button" onClick={() => ask(s)} className="rounded-full border border-line px-2.5 py-1 text-[12.5px] text-ink-2 hover:border-ink-3 hover:text-ink">{s}</button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={m.role === "user" ? "self-end max-w-[85%] rounded-[12px] rounded-br-[4px] bg-ink px-3 py-2 text-[14px] leading-[1.45] text-panel" : "self-start max-w-[90%] whitespace-pre-line text-[14px] leading-[1.55] text-ink"}>
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
        </section>
      )}

      {bubble && !open && (
        <button type="button" onClick={() => { setBubble(null); setOpen(true); }}
          className="papi-pop pointer-events-auto relative mr-2 max-w-[260px] rounded-[12px] border border-line bg-panel px-3 py-2 text-left text-[13.5px] leading-[1.45] text-ink shadow-[0_6px_24px_-10px_rgba(0,0,0,0.25)]"
          aria-live="polite">
          {bubble}
          <span aria-hidden className="absolute -bottom-[7px] right-8 h-3 w-3 rotate-45 border-b border-r border-line bg-panel" />
        </button>
      )}

      <button type="button" onClick={poke} aria-label={open ? "Close chat with Papi" : "Papi, your study buddy. Open chat"} aria-expanded={open}
        className={`papi pointer-events-auto relative rounded-full p-1 outline-none focus-visible:ring-2 focus-visible:ring-ink-3 ${asleep ? "" : "papi-bob"} ${hop ? "papi-hop" : ""}`}>
        <PapiFace mood={open && mood === "sleep" ? "idle" : mood} size={56} />
        {asleep && !open && <span aria-hidden className="papi-z absolute -top-2 right-0 text-[13px] font-semibold text-ink-3">z<span className="text-[10px]">z</span></span>}
      </button>
    </div>
  );
}
