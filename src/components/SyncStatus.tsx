import type { Overview } from "@/server/overview";

const SOURCE_LABEL: Record<string, string> = {
  canvas: "Canvas",
  graph: "Mail",
  enrich: "Enrich",
};

export function SyncStatus({ syncStatus }: { syncStatus: Overview["syncStatus"] }) {
  return (
    <ul className="flex flex-wrap gap-x-5 gap-y-1 text-xs">
      {syncStatus.map((s) => (
        <li key={s.source} className={s.stale ? "text-warn" : "text-ink-3"}>
          <span className="font-medium">{SOURCE_LABEL[s.source] ?? s.source}</span>{" "}
          {s.stale ? (
            <span>
              ⚠ stale{s.lastOkAt ? ` — last synced ${new Date(s.lastOkAt).toLocaleString()}` : " — never synced"}
            </span>
          ) : (
            <span className="tabular-nums">synced {s.lastOkAt ? new Date(s.lastOkAt).toLocaleTimeString() : "—"}</span>
          )}
        </li>
      ))}
    </ul>
  );
}
