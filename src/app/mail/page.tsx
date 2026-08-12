import Link from "next/link";
import { eq, and } from "drizzle-orm";
import { getDb } from "@/server/db";
import { items } from "@/db/schema";
import { AppShell } from "@/components/AppShell";
import { MailList } from "@/components/MailList";

export const dynamic = "force-dynamic";

export default async function MailPage({ searchParams }: PageProps<"/mail">) {
  const sp = await searchParams;
  const showFiltered = sp.filtered === "1";
  const userId = 1;

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
      <h1 className="mb-8 text-lg font-medium text-ink">Mail</h1>

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
          <p className="mt-8 text-xs text-ink-3">
            <Link href="/mail?filtered=1" className="underline decoration-line hover:text-accent">
              {garbage.length} filtered — show
            </Link>
          </p>
        )
      )}
    </AppShell>
  );
}
