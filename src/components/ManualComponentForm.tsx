"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

export function ManualComponentForm({ moduleId }: { moduleId: number }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [weightPct, setWeightPct] = useState("");
  const [scorePct, setScorePct] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(false);
    const res = await fetch("/api/components/manual", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        moduleId,
        name,
        weightPct: weightPct === "" ? null : Number(weightPct),
        scorePct: scorePct === "" ? null : Number(scorePct),
      }),
    });
    setPending(false);
    if (res.ok) {
      setName("");
      setWeightPct("");
      setScorePct("");
      router.refresh();
    } else {
      setError(true);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1 text-xs text-ink-2">
        Name
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          className="border border-line bg-surface px-2 py-1 text-sm text-ink outline-none focus:border-accent"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-ink-2">
        Weight %
        <input
          type="number"
          min="0"
          max="100"
          step="0.1"
          value={weightPct}
          onChange={(e) => setWeightPct(e.target.value)}
          className="w-24 border border-line bg-surface px-2 py-1 text-sm tabular-nums text-ink outline-none focus:border-accent"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-ink-2">
        Score %
        <input
          type="number"
          min="0"
          max="100"
          step="0.1"
          value={scorePct}
          onChange={(e) => setScorePct(e.target.value)}
          className="w-24 border border-line bg-surface px-2 py-1 text-sm tabular-nums text-ink outline-none focus:border-accent"
        />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="border border-line bg-ink px-3 py-1.5 text-xs font-medium text-surface disabled:opacity-50"
      >
        {pending ? "Adding…" : "Add"}
      </button>
      {error && <span className="text-xs text-danger">Could not save.</span>}
    </form>
  );
}
