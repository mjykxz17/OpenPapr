import Link from "next/link";
import { requireUserId } from "@/server/session";
import { eq, and } from "drizzle-orm";
import { getDb } from "@/server/db";
import { items } from "@/db/schema";
import { AppShell } from "@/components/AppShell";
import { MailList } from "@/components/MailList";
import { OutlookConnect } from "@/components/OutlookConnect";
import { users } from "@/db/schema";
import { loadEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

export default async function MailPage({ searchParams }: PageProps<"/mail">) {
  const sp = await searchParams;
  const showFiltered = sp.filtered === "1";
  const userId = await requireUserId();
  const me = getDb().select().from(users).where(eq(users.id, userId)).get();

  const mail = getDb()
    .select()
    .from(items)
    .where(and(eq(items.userId, userId), eq(items.type, "email")))
    .all()
    .filter((i) => !i.dismissed)
    .sort((a, b) => b.firstSeenAt - a.firstSeenAt);

  const important = mail.filter((i) => i.triage !== "garbage");
  const garbage = mail.filter((i) => i.triage === "garbage");

  return (
    <AppShell>
      <h1 className="mb-6 text-2xl font-semibold tracking-[-0.01em] text-ink">Mail</h1>

      <div className="mb-8 max-w-3xl">
        <OutlookConnect connected={Boolean(me?.msRefreshTokenEnc)} configured={Boolean(loadEnv().MS_CLIENT_ID)} />
      </div>

      <section>
        <MailList items={important} dismissible emptyLabel="No mail yet." />
      </section>

      {showFiltered ? (
        <section className="mt-10">
          <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-ink-3">Filtered ({garbage.length})</h2>
          <MailList items={garbage} dismissible greyed emptyLabel="Nothing filtered." />
        </section>
      ) : (
        garbage.length > 0 && (
          <p className="mt-8 text-[13px] text-ink-3">
            <Link href="/mail?filtered=1" className="underline decoration-line hover:text-accent">
              {garbage.length} filtered — show
            </Link>
          </p>
        )
      )}
    </AppShell>
  );
}
