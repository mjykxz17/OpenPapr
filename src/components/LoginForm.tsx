"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

export function LoginForm({ canvasBaseUrl }: { canvasBaseUrl: string }) {
  const router = useRouter();
  const [inviteCode, setInviteCode] = useState("");
  const [canvasToken, setCanvasToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    let res: Response;
    try {
      res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inviteCode, canvasToken }),
      });
    } catch {
      setPending(false);
      setError("Could not reach the server. Check your connection and try again.");
      return;
    }
    setPending(false);
    if (res.ok) {
      router.push("/");
      router.refresh();
      return;
    }
    const body = await res.json().catch(() => null);
    setError(body?.error ?? "Sign in failed. Try again.");
  }

  const field = "border border-line bg-surface px-3 py-2 text-ink outline-none focus:border-accent";

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5 text-sm text-ink-2">
        Invite code
        <input
          type="password"
          name="inviteCode"
          autoComplete="off"
          required
          value={inviteCode}
          onChange={(e) => setInviteCode(e.target.value)}
          className={field}
        />
      </label>

      <label className="flex flex-col gap-1.5 text-sm text-ink-2">
        Canvas access token
        <input
          type="password"
          name="canvasToken"
          autoComplete="off"
          required
          spellCheck={false}
          value={canvasToken}
          onChange={(e) => setCanvasToken(e.target.value)}
          className={field}
        />
      </label>

      <p className="-mt-1 text-xs leading-relaxed text-ink-3">
        Create one in Canvas under{" "}
        <a
          href={`${canvasBaseUrl}/profile/settings`}
          target="_blank"
          rel="noreferrer"
          className="text-accent underline underline-offset-2"
        >
          Account → Settings → New access token
        </a>
        . It is stored encrypted and is only used to read your own courses.
      </p>

      {error && <p role="alert" className="text-sm text-danger">{error}</p>}

      <button
        type="submit"
        disabled={pending}
        className="border border-line bg-ink px-3 py-2 text-sm font-medium text-surface disabled:opacity-50"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
