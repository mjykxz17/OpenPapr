"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

type Mode = "signin" | "setup";

export function LoginForm({ canvasBaseUrl }: { canvasBaseUrl: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("signin");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [canvasToken, setCanvasToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const body = mode === "signin"
      ? { username, password }
      : { inviteCode, canvasToken, username, password };
    let res: Response;
    try {
      res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
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
    const parsed = await res.json().catch(() => null);
    setError(parsed?.error ?? "Sign in failed. Try again.");
  }

  const field = "h-10 rounded-md border border-line-2 bg-surface px-3 text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft";
  const label = "flex flex-col gap-1.5 text-sm text-ink-2";

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div className="flex gap-1 border-b border-line text-[13px]">
        {(["signin", "setup"] as Mode[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => { setMode(m); setError(null); }}
            aria-selected={mode === m}
            className={`-mb-px border-b-2 px-2 py-1.5 transition-colors ${
              mode === m ? "border-accent text-ink" : "border-transparent text-ink-2 hover:text-ink"
            }`}
          >
            {m === "signin" ? "Sign in" : "First time"}
          </button>
        ))}
      </div>

      {mode === "setup" && (
        <>
          <label className={label}>
            Invite code
            <input type="password" autoComplete="off" required value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)} className={field} />
          </label>
          <label className={label}>
            Canvas access token
            <input type="password" autoComplete="off" required spellCheck={false} value={canvasToken}
              onChange={(e) => setCanvasToken(e.target.value)} className={field} />
          </label>
          <p className="-mt-1 text-[13px] leading-relaxed text-ink-2">
            Create one in Canvas under{" "}
            <a href={`${canvasBaseUrl}/profile/settings`} target="_blank" rel="noreferrer"
               className="text-accent underline underline-offset-2">
              Account → Settings → New access token
            </a>
            . It is stored encrypted, and you only paste it once.
          </p>
        </>
      )}

      <label className={label}>
        Username
        <input
          name="username"
          autoComplete="username"
          required
          spellCheck={false}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className={field}
        />
      </label>

      <label className={label}>
        Password
        <input
          type="password"
          name="password"
          autoComplete={mode === "signin" ? "current-password" : "new-password"}
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={field}
        />
      </label>

      {mode === "setup" && (
        <p className="-mt-1 text-[13px] leading-relaxed text-ink-2">
          Pick a username and password now — after this you sign in with those alone,
          and never need the token again.
        </p>
      )}

      {error && <p role="alert" className="text-sm text-danger">{error}</p>}

      <button type="submit" disabled={pending}
        className="h-10 rounded-md bg-accent px-3 text-sm font-medium text-white transition-colors hover:bg-[#0c5f59] disabled:opacity-50">
        {pending ? "Signing in…" : mode === "signin" ? "Sign in" : "Create account"}
      </button>
    </form>
  );
}
