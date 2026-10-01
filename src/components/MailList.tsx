import type { ItemRow } from "@/server/overview";
import { DismissButton } from "./DismissButton";

// "Prof Damith <damith@comp.nus.edu.sg>" → "Prof Damith"; a bare address stays.
function senderName(sender: string | null): string {
  if (!sender) return "Unknown sender";
  const m = sender.match(/^\s*"?([^"<]+?)"?\s*<[^>]+>\s*$/);
  return m ? m[1] : sender;
}

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
        <li key={item.id} className={`flex items-start justify-between gap-3 py-3 ${greyed ? "text-ink-3" : ""}`}>
          {/* Sender, then subject, then why it is here — stacked, so a long
              address never runs under the button on a phone. */}
          <div className="min-w-0 flex-1">
            <p className={`truncate font-semibold ${greyed ? "text-ink-3" : "text-ink"}`} title={item.sender ?? undefined}>{senderName(item.sender)}</p>
            <p className={`mt-0.5 truncate text-sm ${greyed ? "text-ink-3" : "text-ink-2"}`} title={item.title}>{item.title}</p>
            {item.importanceReason && <p className="mt-0.5 text-xs text-ink-3">{item.importanceReason}</p>}
          </div>
          {dismissible && <div className="shrink-0"><DismissButton itemId={item.id} /></div>}
        </li>
      ))}
    </ul>
  );
}
