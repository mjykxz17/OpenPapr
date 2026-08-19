import Link from "next/link";
import { getDb } from "@/server/db";
import { getOverview } from "@/server/overview";
import { loadEnv } from "@/lib/env";
import { AppShell } from "@/components/AppShell";
import { SyncStatus } from "@/components/SyncStatus";
import { WhatsNew } from "@/components/WhatsNew";
import { TodoList } from "@/components/TodoList";
import { MailList } from "@/components/MailList";
import { ModuleCard } from "@/components/ModuleCard";

export const dynamic = "force-dynamic";

export default function Home() {
  const now = Date.now();
  const overview = getOverview(getDb(), 1, now, loadEnv().POLL_INTERVAL_MS);
  const dateLabel = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long" }).format(now);

  return (
    <AppShell>
      {overview.graphAuthBroken && (
        <div className="mb-6 border border-warn bg-warn/10 px-4 py-3 text-sm text-warn">
          Reconnect Microsoft — run scripts/connect-microsoft.ts
        </div>
      )}

      <header className="mb-8 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 border-b border-line pb-4">
        <div>
          <div className="text-lg font-medium tabular-nums text-ink">{dateLabel}</div>
          <div className="text-xs uppercase tracking-wide text-ink-3">AY26/27</div>
        </div>
        <SyncStatus syncStatus={overview.syncStatus} />
      </header>

      {overview.whatsNew.length > 0 && <WhatsNew items={overview.whatsNew} />}

      <section className="mb-10">
        <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-ink-3">Reminders</h2>
        <TodoList todos={overview.todos} modules={overview.modules} now={now} />
      </section>

      <section className="mb-10">
        <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-ink-3">Important mail</h2>
        <MailList items={overview.mail.important} />
        <p className="mt-2 text-xs text-ink-3">
          <Link href="/mail?filtered=1" className="underline decoration-line hover:text-accent">
            {overview.mail.filteredCount} filtered
          </Link>
        </p>
      </section>

      <section id="modules">
        <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-ink-3">Modules</h2>
        {overview.modules.length === 0 ? (
          <p className="text-sm text-ink-3">No modules yet.</p>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {overview.modules.map((m) => (
              <ModuleCard key={m.id} module={m} />
            ))}
          </div>
        )}
      </section>
    </AppShell>
  );
}
