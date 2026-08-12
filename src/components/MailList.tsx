import type { ItemRow } from "@/server/overview";
import { DismissButton } from "./DismissButton";

export function MailList({
  items,
  emptyLabel = "No mail yet.",
  dismissible = false,
  greyed = false,
}: {
  items: ItemRow[];
  emptyLabel?: string;
  dismissible?: boolean;
  greyed?: boolean;
}) {
  if (items.length === 0) return <p className="text-sm text-ink-3">{emptyLabel}</p>;

  return (
    <ul className="divide-y divide-line">
      {items.map((item) => (
        <li key={item.id} className={`flex items-start justify-between gap-4 py-3 ${greyed ? "text-ink-3" : ""}`}>
          <div className="min-w-0">
            <div className="flex items-baseline gap-2">
              <span className={`font-semibold ${greyed ? "text-ink-3" : "text-ink"}`}>{item.sender ?? "Unknown sender"}</span>
              <span className={`truncate text-sm ${greyed ? "text-ink-3" : "text-ink-2"}`}>{item.title}</span>
            </div>
            {item.importanceReason && <p className="mt-0.5 text-xs text-ink-3">{item.importanceReason}</p>}
          </div>
          {dismissible && <DismissButton itemId={item.id} />}
        </li>
      ))}
    </ul>
  );
}
