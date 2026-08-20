import Link from "next/link";
import type { Overview } from "@/server/overview";
import { SOURCE_LABEL } from "@/lib/component-display";

export function ModuleCard({ module: m }: { module: Overview["modules"][number] }) {
  return (
    <div className="border border-line p-3">
      <Link href={`/modules/${m.id}`} className="text-sm font-medium text-ink hover:text-accent">
        {m.code} <span className="font-normal text-ink-2">{m.name}</span>
      </Link>

      <div className="mt-3">
        {m.components.length === 0 ? (
          <p className="text-sm text-ink-3">weightage unknown — add manually</p>
        ) : (
          <table className="w-full text-sm tabular-nums">
            <tbody>
              {m.components.map((c) => (
                <tr key={c.id} className="border-t border-line first:border-t-0">
                  <td className="py-1.5 pr-2 text-ink">{c.name}</td>
                  <td className="py-1.5 pr-2 text-right">{c.weightPct != null ? `${c.weightPct}%` : "—"}</td>
                  <td
                    className={`py-1.5 text-right text-xs ${c.source === "llm_syllabus" ? "text-warn" : "text-ink-3"}`}
                    title={c.source === "llm_syllabus" ? (c.evidence ?? undefined) : undefined}
                  >
                    {SOURCE_LABEL[c.source]}
                  </td>
                </tr>
              ))}
              {m.unaccountedPct != null && (
                <tr className="border-t border-line">
                  <td colSpan={3} className="py-1.5 text-xs text-warn">
                    Unaccounted {m.unaccountedPct}% — add manually
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      <p className="mt-3 truncate text-xs text-ink-3">
        {m.latestAnnouncements[0]?.title ?? "No announcements yet."}
      </p>
    </div>
  );
}
