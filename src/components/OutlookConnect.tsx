"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Phase =
  | { kind: "idle" }
  | { kind: "starting" }
  | { kind: "waiting"; verificationUri: string; userCode: string; intervalMs: number }
  | { kind: "error"; message: string };

export function OutlookConnect({ connected, configured }: { connected: boolean; configured: boolean }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  // While a grant is in flight, ask the server whether Microsoft has seen the
  // code yet. The browser waits, not the request.
  useEffect(() => {
    if (phase.kind !== "waiting") return;
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      let body: { status?: string; error?: string } | null = null;
      try {
        body = await (await fetch("/api/graph/connect")).json();
      } catch {
        // A dropped poll is not fatal — try again on the next tick.
      }
      if (cancelled) return;
      if (body?.status === "connected") {
        setPhase({ kind: "idle" });
        router.refresh();
        return;
      }
      if (body?.status === "expired") {
        setPhase({ kind: "error", message: "That code expired. Start again when you're ready." });
        return;
      }
      if (body?.status === "error") {
        setPhase({ kind: "error", message: body.error ?? "Microsoft rejected the request." });
        return;
      }
      timer.current = setTimeout(tick, phase.intervalMs);
    };
    timer.current = setTimeout(tick, phase.intervalMs);
    return () => { cancelled = true; if (timer.current) clearTimeout(timer.current); };
  }, [phase, router]);

  async function start() {
    setPhase({ kind: "starting" });
    try {
      const res = await fetch("/api/graph/connect", { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "Could not start sign-in");
      setPhase({ kind: "waiting", verificationUri: body.verificationUri, userCode: body.userCode, intervalMs: body.intervalMs ?? 5000 });
    } catch (err) {
      setPhase({ kind: "error", message: err instanceof Error ? err.message : "Could not start sign-in" });
    }
  }

  async function disconnect() {
    await fetch("/api/graph/disconnect", { method: "POST" });
    router.refresh();
  }

  if (!configured) {
    return (
      <p className="border border-line px-4 py-3 text-xs text-ink-3">
        Outlook is not configured on this instance, so mail is unavailable. Canvas still works.
      </p>
    );
  }

  if (connected) {
    return (
      <div className="flex items-center justify-between gap-4 border border-line px-4 py-3">
        <p className="text-xs text-ink-3">Outlook is connected. Mail syncs alongside Canvas.</p>
        <button type="button" onClick={disconnect} className="text-xs text-ink-3 underline underline-offset-2 hover:text-danger">
          Disconnect
        </button>
      </div>
    );
  }

  return (
    <div className="border border-line px-4 py-3">
      {phase.kind === "waiting" ? (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-ink-2">
            Open{" "}
            <a href={phase.verificationUri} target="_blank" rel="noreferrer" className="text-accent underline underline-offset-2">
              {phase.verificationUri.replace(/^https?:\/\//, "")}
            </a>{" "}
            and enter this code:
          </p>
          <div className="flex items-center gap-3">
            <code className="border border-line px-3 py-1.5 text-base tracking-[0.2em] text-ink">{phase.userCode}</code>
            <button
              type="button"
              onClick={() => { void navigator.clipboard?.writeText(phase.userCode); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
              className="text-xs text-ink-3 underline underline-offset-2 hover:text-accent"
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <p className="text-xs text-ink-3">Waiting for you to approve in Microsoft…</p>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-4">
          <p className="text-xs text-ink-3">
            {phase.kind === "error" ? phase.message : "Connect your NUS Outlook to see important mail here."}
          </p>
          <button
            type="button"
            onClick={start}
            disabled={phase.kind === "starting"}
            className="shrink-0 border border-line px-3 py-1.5 text-xs font-medium text-ink hover:border-accent disabled:opacity-50"
          >
            {phase.kind === "starting" ? "Starting…" : phase.kind === "error" ? "Try again" : "Connect Outlook"}
          </button>
        </div>
      )}
    </div>
  );
}
