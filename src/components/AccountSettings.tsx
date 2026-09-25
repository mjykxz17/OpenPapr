"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";
import { LLM_PRESETS, presetFor } from "@/lib/llm-presets";
import { relativeDay, shortTime } from "@/lib/format-date";
import { AboutYou } from "./profile/AboutYou";
import type { ComponentProps } from "react";

type ProviderView = { baseUrl: string; model: string; keyHint: string; rpm: number | null; extra: string };

type Props = {
  welcome: boolean;
  canvasBaseUrl: string;
  canvas: { name: string; tokenHint: string | null; verifiedAt: number | null; failedAt: number | null };
  llm: ProviderView | null;
  fallback: ProviderView | null;
  sharedModel: string | null;
  signIn: { username: string | null; hasPassword: boolean };
  about: ComponentProps<typeof AboutYou>;
};

const field = "h-10 w-full rounded-md border border-line-2 bg-surface px-3 text-[14px] text-ink outline-none placeholder:text-ink-3 focus:border-accent focus:ring-2 focus:ring-accent-soft disabled:opacity-60";
const label = "flex flex-col gap-1.5 text-[13px] text-ink-2";
const primary = "h-10 whitespace-nowrap rounded-md bg-accent px-4 text-sm font-medium text-on-accent transition-colors hover:bg-accent-strong disabled:opacity-50";
const secondary = "h-10 whitespace-nowrap rounded-md border border-line-2 px-4 text-sm text-ink transition-colors hover:bg-ink/[0.05] disabled:opacity-50";

async function send(url: string, method: string, body?: object): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  try {
    const res = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: res.ok, data };
  } catch {
    return { ok: false, data: { error: "Could not reach the server. Check your connection and try again." } };
  }
}

const when = (ms: number) => {
  const now = Date.now();
  const day = relativeDay(ms, now);
  return day === "Today" ? `today, ${shortTime(ms)}` : day === "Yesterday" ? "yesterday" : day;
};

function Section({ id, title, status, children }: { id: string; title: string; status: ReactNode; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="rounded-[10px] border border-line bg-panel">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-line px-6 py-4">
        <h2 id={id} className="text-[15px] font-semibold text-ink">{title}</h2>
        <div className="text-[13px] text-ink-2">{status}</div>
      </div>
      <div className="px-6 py-5">{children}</div>
    </section>
  );
}

function Dot({ tone }: { tone: "ok" | "warn" | "off" }) {
  const c = tone === "ok" ? "bg-accent" : tone === "warn" ? "bg-warn" : "bg-line-2";
  return <span aria-hidden className={`mr-2 inline-block h-2 w-2 translate-y-[-1px] rounded-full ${c}`} />;
}

function Feedback({ error, ok }: { error: string | null; ok: string | null }) {
  if (error) return <p role="alert" className="text-[13px] text-danger">{error}</p>;
  if (ok) return <p role="status" className="text-[13px] text-accent">{ok}</p>;
  return null;
}

// --- Canvas -------------------------------------------------------------

function CanvasSection({ canvas, canvasBaseUrl }: Pick<Props, "canvas" | "canvasBaseUrl">) {
  const router = useRouter();
  const failing = canvas.failedAt !== null && (canvas.verifiedAt === null || canvas.failedAt > canvas.verifiedAt);
  const [open, setOpen] = useState(failing);
  const [token, setToken] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setPending(true); setError(null); setOk(null);
    const r = await send("/api/account/canvas", "PUT", { token });
    setPending(false);
    if (!r.ok) { setError(String(r.data.error ?? "Could not save that token.")); return; }
    setToken(""); setOpen(false); setOk("Token replaced. The next sync uses it.");
    router.refresh();
  }

  const status = failing
    ? <span className="text-warn"><Dot tone="warn" />Token stopped working</span>
    : canvas.tokenHint
      ? <span><Dot tone="ok" />Linked</span>
      : <span><Dot tone="off" />Not linked</span>;

  return (
    <Section id="acct-canvas" title="Canvas" status={status}>
      <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-[14px]">
        <dt className="text-ink-2">Account</dt><dd className="text-ink">{canvas.name}</dd>
        <dt className="text-ink-2">Access token</dt>
        <dd className="font-mono text-[13px] text-ink">{canvas.tokenHint ?? "—"}</dd>
        {canvas.verifiedAt !== null && (<>
          <dt className="text-ink-2">Last worked</dt>
          <dd className="text-ink" suppressHydrationWarning>{when(canvas.verifiedAt)}</dd>
        </>)}
      </dl>

      {failing && (
        <p className="mt-4 rounded-md border border-warn-line bg-warn-soft px-3 py-2 text-[13px] leading-relaxed text-warn-ink">
          Canvas refused this token <span suppressHydrationWarning>{when(canvas.failedAt!)}</span> — it has
          probably expired. Syncing is paused until you paste a new one.
        </p>
      )}

      <div className="mt-4 flex flex-col gap-3">
        {!open ? (
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className={secondary} onClick={() => { setOpen(true); setOk(null); }}>Replace token</button>
            <Feedback error={null} ok={ok} />
          </div>
        ) : (
          <form onSubmit={onSubmit} className="flex max-w-xl flex-col gap-3">
            <label className={label}>
              New Canvas access token
              <input type="password" autoComplete="off" spellCheck={false} required autoFocus value={token}
                onChange={(e) => setToken(e.target.value)} className={field} />
            </label>
            <p className="text-[13px] leading-relaxed text-ink-2">
              Create one in Canvas under{" "}
              <a href={`${canvasBaseUrl}/profile/settings`} target="_blank" rel="noreferrer" className="text-accent underline underline-offset-2">
                Account → Settings → New access token
              </a>. It has to belong to the same Canvas account.
            </p>
            <Feedback error={error} ok={null} />
            <div className="flex gap-2">
              <button type="submit" disabled={pending || !token.trim()} className={primary}>{pending ? "Checking…" : "Check and save"}</button>
              <button type="button" className={secondary} onClick={() => { setOpen(false); setError(null); setToken(""); }}>Cancel</button>
            </div>
          </form>
        )}
      </div>
    </Section>
  );
}

// --- AI provider ----------------------------------------------------------

function ProviderForm({ slot, current, onSaved, onRemoved, removeLabel }: {
  slot: "primary" | "fallback";
  current: ProviderView | null;
  onSaved: string;
  onRemoved: string;
  removeLabel: string;
}) {
  const router = useRouter();
  const [preset, setPreset] = useState<string>(current ? presetFor(current.baseUrl) : slot === "primary" ? "openai" : "openrouter");
  const presetRow = LLM_PRESETS.find((p) => p.id === preset);
  const [baseUrl, setBaseUrl] = useState(current?.baseUrl ?? presetRow?.baseUrl ?? "");
  const [model, setModel] = useState(current?.model ?? "");
  const [apiKey, setApiKey] = useState("");
  const [rpm, setRpm] = useState(current?.rpm ? String(current.rpm) : "");
  const [extra, setExtra] = useState(current?.extra ?? "");
  const [pending, setPending] = useState<"save" | "remove" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const id = `llm-${slot}`;

  // A saved key can be kept only while it stays pointed at the same server.
  const keepsKey = current !== null && baseUrl.replace(/\/+$/, "") === current.baseUrl;

  function pick(pid: string) {
    setPreset(pid); setError(null); setOk(null);
    const p = LLM_PRESETS.find((x) => x.id === pid);
    if (p) setBaseUrl(p.baseUrl);
    else if (presetFor(baseUrl) !== "custom") setBaseUrl("");
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setPending("save"); setError(null); setOk(null);
    const r = await send("/api/account/llm", "PUT", { slot, baseUrl, model, apiKey, rpm: rpm.trim() || null, extra });
    setPending(null);
    if (!r.ok) { setError(String(r.data.error ?? "Could not save that provider.")); return; }
    setApiKey(""); setOk(onSaved);
    router.refresh();
  }

  async function onRemove() {
    setPending("remove"); setError(null); setOk(null);
    const r = await send(`/api/account/llm?slot=${slot}`, "DELETE");
    setPending(null);
    if (!r.ok) { setError(String(r.data.error ?? "Could not remove the key.")); return; }
    setApiKey(""); setModel(""); setRpm(""); setExtra("");
    setOk(onRemoved);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="flex max-w-xl flex-col gap-4">
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1.5 text-[13px] text-ink-2">Provider</legend>
        <div role="radiogroup" aria-label={`${slot === "primary" ? "Provider" : "Fallback provider"}`} className="flex flex-wrap gap-1.5">
          {[...LLM_PRESETS.map((p) => ({ id: p.id, label: p.label })), { id: "custom", label: "Other" }].map((p) => (
            <button key={p.id} type="button" role="radio" aria-checked={preset === p.id} onClick={() => pick(p.id)}
              className={`h-9 rounded-md border px-3 text-[13px] transition-colors ${
                preset === p.id ? "border-accent bg-accent-soft text-ink" : "border-line-2 text-ink-2 hover:bg-ink/[0.05] hover:text-ink"
              }`}>
              {p.label}
            </button>
          ))}
        </div>
      </fieldset>

      <label className={label} htmlFor={`${id}-url`}>
        Base URL
        {/* Always editable: a preset only fills it in. Editing it to anything
            else switches the provider to Other. */}
        <input id={`${id}-url`} value={baseUrl} required spellCheck={false} inputMode="url" placeholder="https://…/v1"
          onChange={(e) => { setBaseUrl(e.target.value); setPreset(presetFor(e.target.value)); }}
          className={`${field} font-mono text-[13px]`} />
        <span className="text-[12px] text-ink-3">
          {preset === "custom" ? "Any endpoint that speaks the OpenAI chat-completions API — a gateway, a proxy, or a self-hosted server." : "Filled in for you — edit it if you use a different address."}
        </span>
      </label>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_11rem]">
        <label className={label} htmlFor={`${id}-model`}>
          Model
          <input id={`${id}-model`} value={model} onChange={(e) => setModel(e.target.value)} required spellCheck={false}
            placeholder={presetRow ? `e.g. ${presetRow.modelHint}` : "model name"} className={`${field} font-mono text-[13px]`} />
        </label>
        <label className={label} htmlFor={`${id}-rpm`}>
          Requests per minute
          <input id={`${id}-rpm`} value={rpm} onChange={(e) => setRpm(e.target.value.replace(/[^0-9]/g, ""))} inputMode="numeric"
            placeholder="No limit" className={`${field} tabular-nums`} />
        </label>
      </div>
      <p className="-mt-2 text-[12px] leading-relaxed text-ink-3">
        Set this to your plan&apos;s rate limit. Requests beyond it wait their turn in a queue instead of failing — a study
        guide fires many at once, so free and low tiers need it.
      </p>

      <details className="group" open={Boolean(current?.extra)}>
        <summary className="cursor-pointer text-[13px] text-ink-2 hover:text-ink">Advanced request options</summary>
        <label className={`${label} mt-2`} htmlFor={`${id}-extra`}>
          <span className="text-[12px] leading-relaxed text-ink-3">
            JSON added to every request to this provider — for example OpenRouter&apos;s routing or reasoning settings.
            OpenPapr still sets the model, messages and length itself.
          </span>
          <textarea id={`${id}-extra`} value={extra} onChange={(e) => setExtra(e.target.value)} rows={4} spellCheck={false}
            placeholder={'{\n  "reasoning": { "effort": "low" },\n  "provider": { "sort": "throughput" }\n}'}
            className="w-full rounded-md border border-line-2 bg-surface px-3 py-2 font-mono text-[12.5px] text-ink outline-none placeholder:text-ink-3 focus:border-accent" />
        </label>
      </details>

      <label className={label} htmlFor={`${id}-key`}>
        API key
        <input id={`${id}-key`} type="password" autoComplete="off" spellCheck={false} value={apiKey} onChange={(e) => setApiKey(e.target.value)}
          required={!keepsKey} placeholder={keepsKey ? `${current!.keyHint} — leave blank to keep` : presetRow?.keyHint ?? ""}
          className={`${field} font-mono text-[13px]`} />
        <span className="text-[12px] leading-relaxed text-ink-3">
          Stored encrypted and only ever sent to the base URL above.
          {presetRow && <> Get one from <a href={presetRow.keysUrl} target="_blank" rel="noreferrer" className="text-accent underline underline-offset-2">{presetRow.label}</a>.</>}
        </span>
      </label>

      <Feedback error={error} ok={ok} />

      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={pending !== null} className={primary}>
          {pending === "save" ? "Testing…" : "Test and save"}
        </button>
        {current && (
          <button type="button" disabled={pending !== null} onClick={onRemove} className={secondary}>
            {pending === "remove" ? "Removing…" : removeLabel}
          </button>
        )}
      </div>
    </form>
  );
}

function LlmSection({ llm, fallback, sharedModel }: Pick<Props, "llm" | "fallback" | "sharedModel">) {
  const [showFallback, setShowFallback] = useState(Boolean(fallback));
  const describe = (p: ProviderView) => (
    <><span className="text-ink">{p.model}</span> · <span className="font-mono text-[13px]">{p.keyHint}</span>{p.rpm ? <> · {p.rpm}/min</> : null}</>
  );
  const status = llm
    ? <span><Dot tone="ok" />Your key{fallback ? " + fallback" : ""}</span>
    : fallback ? <span><Dot tone="ok" />Fallback only</span>
      : sharedModel ? <span><Dot tone="off" />Shared key</span> : <span className="text-warn"><Dot tone="warn" />Not set up</span>;

  return (
    <Section id="acct-llm" title="AI provider" status={status}>
      <p className="max-w-2xl text-[14px] leading-relaxed text-ink-2">
        Study guides, profiles, mail triage, deadline extraction and assessment weightage are written by a language model.{" "}
        {llm
          ? <>They run on your key ({describe(llm)}){fallback ? <>, and switch to your fallback ({describe(fallback)}) whenever it fails</> : null}.</>
          : fallback
            ? <>Only a fallback is set, so it is used for everything ({describe(fallback)}).</>
            : sharedModel
              ? <>Right now they use the shared OpenPapr key ({sharedModel}). Add your own to use your quota and pick the model.</>
              : <>Add an API key to switch them on.</>}
      </p>

      <div className="mt-5">
        <ProviderForm slot="primary" current={llm} removeLabel="Remove my key"
          onSaved="Key works — saved. Everything now uses it."
          onRemoved={fallback ? "Removed. Your fallback is used for everything now." : sharedModel ? "Removed. The shared key is used again." : "Removed."} />
      </div>

      <div className="mt-7 border-t border-line pt-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-[14px] font-semibold text-ink">Fallback provider</h3>
          {!showFallback && (
            <button type="button" onClick={() => setShowFallback(true)} className="text-[13px] font-medium text-accent hover:underline">+ Add a fallback</button>
          )}
        </div>
        <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-ink-2">
          Used automatically when your main provider fails — it is down, rate-limited, out of credit or the key stops working —
          so a study guide finishes instead of stopping half-way. A different company is the safest choice.
        </p>
        {showFallback && (
          <div className="mt-4">
            <ProviderForm slot="fallback" current={fallback} removeLabel="Remove fallback"
              onSaved="Fallback works — saved. It takes over whenever your main provider fails."
              onRemoved="Fallback removed." />
          </div>
        )}
      </div>
    </Section>
  );
}

// --- Sign-in --------------------------------------------------------------

function SignInSection({ signIn }: Pick<Props, "signIn">) {
  const router = useRouter();
  const [username, setUsername] = useState(signIn.username ?? "");
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setPending(true); setError(null); setOk(null);
    const r = await send("/api/account/password", "PUT", { username, currentPassword: current, newPassword: next });
    setPending(false);
    if (!r.ok) { setError(String(r.data.error ?? "Could not save.")); return; }
    setCurrent(""); setNext("");
    setOk(signIn.hasPassword ? "Password changed." : "Saved. Sign in with these from now on — no token needed.");
    router.refresh();
  }

  const status = signIn.hasPassword
    ? <span><Dot tone="ok" />{signIn.username}</span>
    : <span className="text-warn"><Dot tone="warn" />No password yet</span>;

  return (
    <Section id="acct-signin" title="Sign-in" status={status}>
      {!signIn.hasPassword && (
        <p className="mb-4 max-w-2xl text-[14px] leading-relaxed text-ink-2">
          Set a username and password so you can sign in without the invite code and Canvas token.
        </p>
      )}
      <form onSubmit={onSubmit} className="flex max-w-xl flex-col gap-4">
        <label className={label}>
          Username
          <input name="username" autoComplete="username" spellCheck={false} required value={username}
            onChange={(e) => setUsername(e.target.value)} readOnly={signIn.hasPassword}
            className={`${field} ${signIn.hasPassword ? "bg-sunken text-ink-2" : ""}`} />
        </label>
        {signIn.hasPassword && (
          <label className={label}>
            Current password
            <input type="password" autoComplete="current-password" required value={current}
              onChange={(e) => setCurrent(e.target.value)} className={field} />
          </label>
        )}
        <label className={label}>
          {signIn.hasPassword ? "New password" : "Password"}
          <input type="password" autoComplete="new-password" required minLength={8} value={next}
            onChange={(e) => setNext(e.target.value)} className={field} />
          <span className="text-[12px] text-ink-3">At least 8 characters.</span>
        </label>
        <Feedback error={error} ok={ok} />
        <div>
          <button type="submit" disabled={pending} className={primary}>
            {pending ? "Saving…" : signIn.hasPassword ? "Change password" : "Save sign-in"}
          </button>
        </div>
      </form>
    </Section>
  );
}

export function AccountSettings(props: Props) {
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      {props.welcome && (
        <p role="status" className="rounded-[10px] border border-line bg-panel px-4 py-3 text-[14px] leading-relaxed text-ink">
          You’re in. Your Canvas token is saved, so you won’t need it again.
          {!props.llm && " Add an AI key below to generate study guides with your own model."}
        </p>
      )}
      <AboutYou {...props.about} />
      <CanvasSection canvas={props.canvas} canvasBaseUrl={props.canvasBaseUrl} />
      <LlmSection llm={props.llm} fallback={props.fallback} sharedModel={props.sharedModel} />
      <SignInSection signIn={props.signIn} />
    </div>
  );
}
