"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { clearOfflineCaches } from "@/lib/offline";

function Card({ id, title, status, children }: { id: string; title: string; status?: ReactNode; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="rounded-[10px] border border-line bg-panel">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-line px-6 py-4">
        <h2 id={id} className="text-[15px] font-semibold text-ink">{title}</h2>
        {status && <div className="text-[13px] text-ink-2">{status}</div>}
      </div>
      <div className="px-6 py-5">{children}</div>
    </section>
  );
}

const primary = "h-10 whitespace-nowrap rounded-md bg-accent px-4 text-sm font-medium text-on-accent transition-colors hover:bg-accent-strong disabled:opacity-50";
const secondary = "h-10 whitespace-nowrap rounded-md border border-line-2 px-4 text-sm text-ink transition-colors hover:bg-ink/[0.05] disabled:opacity-50";

// --- calendar feed ------------------------------------------------------------
// A private link calendar apps subscribe to. Deadlines and expected quizzes
// always; each day's study steps if the student wants them too.
export function CalendarSection({ url: initial }: { url: string | null }) {
  const [path, setPath] = useState(initial);
  const [steps, setSteps] = useState(false);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const https = path ? `${origin}${path}${steps ? "?steps=1" : ""}` : null;
  const webcal = https?.replace(/^https?:/, "webcal:") ?? null;

  async function make(reset: boolean) {
    setBusy(true);
    const r = await fetch("/api/calendar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reset }) }).catch(() => null);
    const d = r?.ok ? ((await r.json()) as { path: string }) : null;
    if (d) setPath(d.path);
    setBusy(false);
  }
  async function off() {
    setBusy(true);
    await fetch("/api/calendar", { method: "DELETE" }).catch(() => null);
    setPath(null);
    setBusy(false);
  }
  async function copy() {
    if (!https) return;
    try { await navigator.clipboard.writeText(https); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* select by hand */ }
  }

  return (
    <Card id="acct-calendar" title="Calendar" status={path ? "Feed on" : "Off"}>
      <p className="max-w-2xl text-[14px] leading-relaxed text-ink-2">
        Put your deadlines, quiz windows and expected quizzes into Google Calendar, Apple Calendar or Outlook, beside your classes. It updates on its own, about every hour.
      </p>
      {!path ? (
        <button type="button" onClick={() => make(false)} disabled={busy} className={`${primary} mt-4`}>Make my calendar link</button>
      ) : (
        <div className="mt-4 flex flex-col gap-3">
          <label className="flex items-center gap-2 text-[14px] text-ink">
            <input type="checkbox" checked={steps} onChange={(e) => setSteps(e.target.checked)} className="h-4 w-4 accent-[var(--accent)]" />
            Also add each day&apos;s study steps (as all-day reminders)
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <input readOnly value={https ?? ""} onFocus={(e) => e.currentTarget.select()} aria-label="Calendar link"
              className="h-10 min-w-0 flex-1 rounded-md border border-line-2 bg-surface px-3 font-mono text-[12px] text-ink-2" />
            <button type="button" onClick={copy} className={secondary}>{copied ? "Copied" : "Copy"}</button>
          </div>
          <div className="flex flex-wrap gap-2">
            {webcal && <a href={webcal} className={`${primary} inline-flex items-center no-underline`}>Add to Apple Calendar</a>}
            {https && (
              <a href={`https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal ?? https)}`} target="_blank" rel="noreferrer" className={`${secondary} inline-flex items-center no-underline`}>
                Add to Google Calendar
              </a>
            )}
          </div>
          <p className="text-[12px] leading-relaxed text-ink-3">
            Anyone with this link can see your deadlines, so keep it to yourself. If it gets out,{" "}
            <button type="button" onClick={() => make(true)} disabled={busy} className="text-accent underline underline-offset-2">make a new link</button>{" "}
            (the old one stops working) or{" "}
            <button type="button" onClick={off} disabled={busy} className="text-accent underline underline-offset-2">turn the feed off</button>.
          </p>
        </div>
      )}
    </Card>
  );
}

// --- your data -----------------------------------------------------------------
export function DataSection() {
  const [asking, setAsking] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function remove() {
    setBusy(true);
    setError(null);
    const r = await fetch("/api/account/delete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirm: typed }) }).catch(() => null);
    if (r?.ok) {
      await clearOfflineCaches();
      router.push("/login");
      router.refresh();
      return;
    }
    const d = (await r?.json().catch(() => null)) as { error?: string } | null;
    setError(d?.error ?? "Could not delete the account. Try again.");
    setBusy(false);
  }

  return (
    <Card id="acct-data" title="Your data">
      <p className="max-w-2xl text-[14px] leading-relaxed text-ink-2">
        Everything OpenPapr keeps about you — modules, tasks, guides, notes, chats with Papi — is yours. Download it as a file, or delete your account and all of it.
        Your Canvas token, API keys and password are never included in the download.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <a href="/api/account/export" className={`${secondary} inline-flex items-center no-underline`}>Download my data</a>
        {!asking && <button type="button" onClick={() => setAsking(true)} className={`${secondary} text-danger hover:border-danger`}>Delete my account</button>}
      </div>
      {asking && (
        <div className="mt-4 max-w-md rounded-md border border-danger/40 bg-danger/[0.04] p-4">
          <p className="text-[14px] text-ink">This deletes your account and everything in it, for good. Type <span className="font-mono font-semibold">DELETE</span> to confirm.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <input value={typed} onChange={(e) => setTyped(e.target.value)} aria-label="Type DELETE to confirm"
              className="h-10 w-40 rounded-md border border-line-2 bg-surface px-3 font-mono text-[14px] text-ink outline-none focus:border-danger" />
            <button type="button" onClick={remove} disabled={busy || typed !== "DELETE"} className="h-10 rounded-md bg-danger px-4 text-sm font-medium text-white disabled:opacity-40">Delete everything</button>
            <button type="button" onClick={() => { setAsking(false); setTyped(""); }} className={secondary}>Cancel</button>
          </div>
          {error && <p role="alert" className="mt-2 text-[13px] text-danger">{error}</p>}
        </div>
      )}
    </Card>
  );
}
