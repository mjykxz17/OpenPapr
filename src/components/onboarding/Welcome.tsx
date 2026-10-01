"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { PapiMark } from "@/components/brand/PapiMark";
import { LLM_PRESETS } from "@/lib/llm-presets";

type Props = {
  name: string; canvasBaseUrl: string; canvasLinked: boolean; ownModel: string | null;
  sharedAvailable: boolean; sharedCalls: number; major: string; studyYear: number | null;
};

const STEPS = ["hello", "canvas", "ai", "about", "done"] as const;
type Step = (typeof STEPS)[number];

// The AI choices shown first, in the order a student should consider them.
const CHOICES: { id: string; badge?: string; blurb: string }[] = [
  { id: "nus", badge: "For NUS students", blurb: "Run by NUS School of Computing, for NUS students and staff." },
  { id: "agnes", badge: "Free right now", blurb: "Agnes 3.0 Flash: quick, good at reading slides, and costs nothing at the moment." },
  { id: "openai", blurb: "Your own OpenAI key. GPT-5 mini is cheap and capable." },
  { id: "anthropic", blurb: "Your own Claude key. Claude Haiku is fast and careful with sources." },
];

const primary = "inline-flex h-11 items-center justify-center rounded-md bg-accent px-5 text-[15px] font-medium text-on-accent transition-colors hover:bg-accent-strong disabled:opacity-50";
const secondary = "inline-flex h-11 items-center justify-center rounded-md px-4 text-[14px] text-ink-2 hover:text-ink";
const field = "h-11 w-full rounded-md border border-line-2 bg-surface px-3 text-[15px] text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft";

async function put(url: string, body: unknown, method = "PUT"): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
  const data = ((await r?.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  return { ok: Boolean(r?.ok), data };
}

export function Welcome(p: Props) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("hello");
  const [canvasDone, setCanvasDone] = useState(p.canvasLinked ? "Connected" : "");
  const [aiDone, setAiDone] = useState(p.ownModel ? `Your key · ${p.ownModel}` : "");
  const [aboutDone, setAboutDone] = useState(p.major ? p.major : "");
  const idx = STEPS.indexOf(step);
  const next = () => setStep(STEPS[Math.min(STEPS.length - 1, idx + 1)]!);
  const back = () => setStep(STEPS[Math.max(0, idx - 1)]!);
  const finish = async () => { await put("/api/account/onboarded", {}, "POST"); router.push("/"); router.refresh(); };

  return (
    <div className="flex min-h-svh flex-col bg-surface">
      <header className="mx-auto flex w-full max-w-2xl items-center justify-between px-5 pt-6">
        <span className="flex items-center gap-2 text-[15px] font-semibold text-ink"><PapiMark size={28} /> OpenPapr</span>
        {step !== "done" && <button type="button" onClick={finish} className="text-[13px] text-ink-3 hover:text-ink">Skip setup</button>}
      </header>
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-5 pb-10 pt-8">
        {step !== "hello" && step !== "done" && (
          <ol className="mb-8 flex items-center gap-2" aria-label="Setup progress">
            {(["canvas", "ai", "about"] as const).map((s, i) => (
              <li key={s} className="flex flex-1 flex-col gap-1.5">
                <span className={`h-1 rounded-full ${STEPS.indexOf(s) <= idx ? "bg-accent" : "bg-line"}`} />
                <span className={`text-[12px] ${s === step ? "font-medium text-ink" : "text-ink-3"}`}>{i + 1}. {s === "canvas" ? "Canvas" : s === "ai" ? "AI model" : "About you"}</span>
              </li>
            ))}
          </ol>
        )}

        {step === "hello" && (
          <Section title={`Welcome${p.name ? `, ${p.name.split(" ")[0]}` : ""}.`} lede="OpenPapr reads your course material and turns it into a plan. Three quick steps, and you can skip any of them.">
            <ul className="mt-2 flex flex-col gap-3">
              {[
                ["Study guides that write themselves", "From your lecture slides, with every point linked to its slide."],
                ["Tasks you can do today", "Deadlines from Canvas, announcements and slides, broken into small steps."],
                ["Answers from your own material", "Ask Papi anything about your modules and see exactly where the answer came from."],
              ].map(([t, d]) => (
                <li key={t} className="flex gap-3 rounded-[10px] border border-line bg-panel px-4 py-3">
                  <span aria-hidden className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accent" />
                  <span><span className="block text-[15px] font-medium text-ink">{t}</span><span className="text-[14px] text-ink-2">{d}</span></span>
                </li>
              ))}
            </ul>
            <Actions><button type="button" onClick={next} className={primary}>Set up OpenPapr</button></Actions>
          </Section>
        )}

        {step === "canvas" && <CanvasStep base={p.canvasBaseUrl} done={canvasDone} onDone={(n) => { setCanvasDone(n); next(); }} onSkip={next} onBack={back} />}
        {step === "ai" && <AiStep done={aiDone} shared={p.sharedAvailable} sharedCalls={p.sharedCalls} onDone={(d) => { setAiDone(d); next(); }} onSkip={next} onBack={back} />}
        {step === "about" && <AboutStep major={p.major} year={p.studyYear} onDone={(d) => { setAboutDone(d); next(); }} onSkip={next} onBack={back} />}

        {step === "done" && (
          <Section title="You're set." lede="Here's where things stand. You can change any of it later on the Account page.">
            <ul className="flex flex-col divide-y divide-line rounded-[10px] border border-line bg-panel">
              <Status label="Canvas" value={canvasDone} empty="Not connected. Your modules appear once it is." />
              <Status label="AI model" value={aiDone} empty={p.sharedAvailable ? "Shared AI, with a monthly allowance" : "None yet. Guides, task plans and Papi's answers need one."} />
              <Status label="About you" value={aboutDone} empty="Skipped" />
            </ul>
            <p className="mt-5 text-[14px] text-ink-2">
              Next, try <kbd className="rounded border border-line-2 px-1 font-mono text-[12px]">⌘K</kbd> to search everything, or open Account to add your deadlines to Google or Apple Calendar.
              {canvasDone && " Your first sync takes a minute or two."}
            </p>
            <Actions><button type="button" onClick={finish} className={primary}>Go to my home</button></Actions>
          </Section>
        )}
      </main>
    </div>
  );
}

function Section({ title, lede, children }: { title: string; lede: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.01em] text-ink">{title}</h1>
      <p className="max-w-xl text-[15px] leading-relaxed text-ink-2">{lede}</p>
      {children}
    </section>
  );
}

function Actions({ children }: { children: ReactNode }) {
  return <div className="mt-6 flex flex-wrap items-center gap-2">{children}</div>;
}

function Status({ label, value, empty }: { label: string; value: string; empty: string }) {
  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <span aria-hidden className={`mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${value ? "border-accent bg-accent text-on-accent" : "border-line-2"}`}>
        {value && <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="m3.5 8.5 3 3 6-7" /></svg>}
      </span>
      <span><span className="block text-[14px] font-medium text-ink">{label}</span><span className="text-[13px] text-ink-2">{value || empty}</span></span>
    </li>
  );
}

function Err({ text }: { text: string | null }) {
  return text ? <p role="alert" className="text-[14px] text-danger">{text}</p> : null;
}

function CanvasStep({ base, done, onDone, onSkip, onBack }: { base: string; done: string; onDone: (n: string) => void; onSkip: () => void; onBack: () => void }) {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    setBusy(true); setError(null);
    const r = await put("/api/account/canvas", { token });
    setBusy(false);
    if (r.ok) onDone(`Connected as ${String(r.data.name ?? "you")}`);
    else setError(String(r.data.error ?? "That didn't work. Try again."));
  }
  return (
    <Section title="Connect Canvas" lede="OpenPapr reads your modules, deadlines, announcements and slides through a Canvas access token. It's stored encrypted and only used to read.">
      {done ? (
        <p className="rounded-[10px] border border-accent/30 bg-accent-soft px-4 py-3 text-[14px] text-ink">{done}. Your modules are syncing.</p>
      ) : (
        <>
          <ol className="flex list-decimal flex-col gap-1 pl-5 text-[14px] text-ink-2">
            <li>Open <a href={`${base}/profile/settings`} target="_blank" rel="noreferrer" className="text-accent underline underline-offset-2">Canvas → Account → Settings</a>.</li>
            <li>Under <b className="font-medium text-ink">Approved Integrations</b>, choose <b className="font-medium text-ink">+ New Access Token</b>.</li>
            <li>Name it &ldquo;OpenPapr&rdquo;, generate it, and paste it here.</li>
          </ol>
          <input type="password" autoComplete="off" spellCheck={false} value={token} onChange={(e) => setToken(e.target.value)} placeholder="Canvas access token" aria-label="Canvas access token" className={field} />
          <Err text={error} />
        </>
      )}
      <Actions>
        {done ? <button type="button" onClick={onSkip} className={primary}>Continue</button>
          : <button type="button" onClick={save} disabled={busy || token.trim().length < 10} className={primary}>{busy ? "Checking with Canvas…" : "Connect Canvas"}</button>}
        {!done && <button type="button" onClick={onSkip} className={secondary}>Skip for now</button>}
        <button type="button" onClick={onBack} className={`${secondary} ml-auto`}>Back</button>
      </Actions>
    </Section>
  );
}

function AiStep({ done, shared, sharedCalls, onDone, onSkip, onBack }: { done: string; shared: boolean; sharedCalls: number; onDone: (d: string) => void; onSkip: () => void; onBack: () => void }) {
  const [pick, setPick] = useState<string | null>(null);
  const preset = LLM_PRESETS.find((x) => x.id === pick);
  const [model, setModel] = useState("");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const choose = (id: string) => {
    setPick(id); setError(null); setKey("");
    const pr = LLM_PRESETS.find((x) => x.id === id);
    setModel(pr && id !== "nus" ? pr.modelHint : "");
  };
  async function save() {
    if (!preset) return;
    setBusy(true); setError(null);
    const r = await put("/api/account/llm", { slot: "primary", baseUrl: preset.baseUrl, model, apiKey: key });
    setBusy(false);
    if (r.ok) onDone(`${preset.label} · ${model}`);
    else setError(String(r.data.error ?? "That key didn't work. Check it and try again."));
  }
  return (
    <Section title="Choose an AI model" lede="It writes your study guides, plans your tasks and answers your questions. Pick one of these, or bring any OpenAI-compatible provider from the Account page later.">
      {done && <p className="rounded-[10px] border border-accent/30 bg-accent-soft px-4 py-3 text-[14px] text-ink">Using {done}. You can pick another below.</p>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {CHOICES.map((c) => {
          const pr = LLM_PRESETS.find((x) => x.id === c.id)!;
          return (
            <button key={c.id} type="button" onClick={() => choose(c.id)} aria-pressed={pick === c.id}
              className={`flex flex-col items-start gap-1 rounded-[10px] border px-4 py-3 text-left transition-colors ${pick === c.id ? "border-accent bg-accent-soft" : "border-line bg-panel hover:border-line-2"}`}>
              <span className="flex w-full items-center justify-between gap-2">
                <span className="text-[15px] font-medium text-ink">{pr.label}</span>
                {c.badge && <span className="rounded-full bg-accent px-2 py-px text-[11px] font-semibold text-on-accent">{c.badge}</span>}
              </span>
              <span className="text-[13px] leading-snug text-ink-2">{c.blurb}</span>
            </button>
          );
        })}
      </div>
      {preset && (
        <div className="flex flex-col gap-3 rounded-[10px] border border-line bg-panel p-4">
          {preset.note && <p className="text-[13px] text-ink-2">{preset.note}</p>}
          <label className="flex flex-col gap-1.5 text-[13px] text-ink-2">Model
            <input value={model} onChange={(e) => setModel(e.target.value)} placeholder={preset.modelHint} spellCheck={false} className={`${field} font-mono text-[14px]`} />
          </label>
          <label className="flex flex-col gap-1.5 text-[13px] text-ink-2">API key
            <input type="password" autoComplete="off" spellCheck={false} value={key} onChange={(e) => setKey(e.target.value)} placeholder={preset.keyHint} className={`${field} font-mono text-[14px]`} />
          </label>
          <p className="text-[12px] text-ink-3">Get a key from <a href={preset.keysUrl} target="_blank" rel="noreferrer" className="text-accent underline underline-offset-2">{preset.label}</a>. It&apos;s stored encrypted and only sent to {preset.label}.</p>
          <Err text={error} />
        </div>
      )}
      <Actions>
        {preset ? <button type="button" onClick={save} disabled={busy || !model.trim() || key.trim().length < 8} className={primary}>{busy ? "Testing the key…" : "Test and save"}</button>
          : done ? <button type="button" onClick={onSkip} className={primary}>Continue</button> : null}
        <button type="button" onClick={onSkip} className={secondary}>
          {done ? "Keep it" : shared ? `Use the shared AI for now (${sharedCalls} calls a month)` : "Skip: basic mode for now"}
        </button>
        <button type="button" onClick={onBack} className={`${secondary} ml-auto`}>Back</button>
      </Actions>
    </Section>
  );
}

function AboutStep({ major: m0, year: y0, onDone, onSkip, onBack }: { major: string; year: number | null; onDone: (d: string) => void; onSkip: () => void; onBack: () => void }) {
  const [major, setMajor] = useState(m0);
  const [year, setYear] = useState(y0 ? String(y0) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    setBusy(true); setError(null);
    const r = await put("/api/account/about", { major, studyYear: year ? Number(year) : null, styleLearning: true });
    setBusy(false);
    if (r.ok) onDone([major, year && `Year ${year}`].filter(Boolean).join(" · "));
    else setError(String(r.data.error ?? "Couldn't save that."));
  }
  return (
    <Section title="A little about you" lede="Your major and year shape how guides explain things and what the weekly plan stresses. Both are optional.">
      <label className="flex flex-col gap-1.5 text-[13px] text-ink-2">Major
        <input value={major} onChange={(e) => setMajor(e.target.value)} placeholder="e.g. Information Security" maxLength={120} className={field} />
      </label>
      <label className="flex flex-col gap-1.5 text-[13px] text-ink-2">Year
        <select value={year} onChange={(e) => setYear(e.target.value)} className={field}>
          <option value="">Prefer not to say</option>
          {[1, 2, 3, 4, 5].map((y) => <option key={y} value={y}>Year {y}</option>)}
        </select>
      </label>
      <Err text={error} />
      <Actions>
        <button type="button" onClick={save} disabled={busy || (!major.trim() && !year)} className={primary}>{busy ? "Saving…" : "Save"}</button>
        <button type="button" onClick={onSkip} className={secondary}>Skip</button>
        <button type="button" onClick={onBack} className={`${secondary} ml-auto`}>Back</button>
      </Actions>
    </Section>
  );
}
