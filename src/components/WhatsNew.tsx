import type { ItemRow } from "@/server/overview";
import { MarkSeenButton } from "./MarkSeenButton";

export function WhatsNew({ items }: { items: ItemRow[] }) {
  return (
    <section className="mb-10 border border-[#d6e5e2] bg-[#f4f9f8] p-4">
      <div className="mb-3 flex items-center justify-between gap-4">
        <h2 className="text-xs font-medium uppercase tracking-wide text-ink-3">New since your last visit</h2>
        <MarkSeenButton />
      </div>
      <ul className="space-y-2">
        {items.map((item) => (
          <li key={item.id} className="text-sm leading-snug">
            {item.type === "deadline_change" && (
              <span className="mr-2 align-middle text-xs font-medium uppercase tracking-wide text-danger">
                Deadline moved
              </span>
            )}
            <span className={item.type === "deadline_change" ? "text-danger" : "text-ink"}>{item.title}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
