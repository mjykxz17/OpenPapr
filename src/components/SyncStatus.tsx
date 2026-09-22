import type { Overview } from "@/server/overview";
import { syncedLabel } from "@/lib/format-date";

const SOURCE_LABEL: Record<string, string> = {
  canvas: "Canvas",
  graph: "Mail",
  enrich: "Enrich",
};

// One line: a dot for the overall state, the freshest healthy source, and
// any stale source named. The full per-source list is in each item's title.
export function SyncStatus({ syncStatus, now }: { syncStatus: Overview["syncStatus"]; now: number }) {
  const stale = syncStatus.filter((s) => s.stale);
  const fresh = syncStatus.filter((s) => !s.stale && s.lastOkAt !== null);
  const latest = fresh.reduce<(typeof fresh)[number] | null>((a, s) => (a === null || (s.lastOkAt ?? 0) > (a.lastOkAt ?? 0) ? s : a), null);
  const detail = syncStatus
    .map((s) => `${SOURCE_LABEL[s.source] ?? s.source}: ${s.lastOkAt ? syncedLabel(s.lastOkAt, now) : "never"}${s.stale ? " (stale)" : ""}`)
    .join(" · ");
  return (
    <div className="flex items-center gap-2 text-[13px] tabular-nums text-ink-2" title={detail}>
      <span aria-hidden className={`h-2 w-2 rounded-full ${stale.length > 0 ? "bg-warn" : "bg-accent"}`} />
      {latest ? (
        <span>
          {SOURCE_LABEL[latest.source] ?? latest.source} synced {syncedLabel(latest.lastOkAt!, now)}
        </span>
      ) : (
        <span>Not synced yet</span>
      )}
      {stale.map((s) => (
        <span key={s.source} className="text-warn">
          · {SOURCE_LABEL[s.source] ?? s.source} stale{s.lastOkAt ? ` since ${syncedLabel(s.lastOkAt, now)}` : ""}
        </span>
      ))}
    </div>
  );
}
