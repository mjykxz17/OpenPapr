"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { DndContext, PointerSensor, KeyboardSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { DEFAULT_LAYOUT, SIZE_CLASS, SIZE_NAMES, WIDGETS, type Size, type Slot, type WidgetId } from "@/lib/home-layout";

// The home screen as a phone home screen: widgets on a four-column grid,
// each at a snap size. "Edit home" makes them jiggle: drag to move, pick a
// size, × to take one off, + to put it back. The server renders every face of
// every widget; this only decides which one shows where.
export type WidgetViews = Record<WidgetId, Partial<Record<Size, ReactNode>>>;

function save(layout: Slot[]): Promise<unknown> {
  return fetch("/api/home-layout", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ layout }),
  }).catch(() => {});
}

function Tile({ slot, view, editing, onSize, onHide }: {
  slot: Slot; view: ReactNode; editing: boolean; onSize: (s: Size) => void; onHide: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: slot.id, disabled: !editing });
  const style = { transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 20 : undefined };
  const w = WIDGETS[slot.id];
  return (
    <div ref={setNodeRef} style={style} className={`relative min-w-0 ${SIZE_CLASS[slot.size]} ${editing ? (isDragging ? "opacity-90" : "widget-wobble") : ""}`}>
      <div className={`h-full ${editing ? "pointer-events-none select-none" : ""}`} aria-hidden={editing || undefined}>{view}</div>
      {editing && (
        <>
          {/* The whole widget is the drag handle while editing. */}
          <div {...attributes} {...listeners} aria-label={`Move ${w.title}`} className={`absolute inset-0 rounded-[10px] border-2 border-dashed border-ink-3/60 bg-panel/40 ${isDragging ? "cursor-grabbing" : "cursor-grab"} touch-none`} />
          <button type="button" onClick={onHide} aria-label={`Remove ${w.title}`} title="Remove from home"
            className="absolute -left-2.5 -top-2.5 z-10 flex h-6 w-6 items-center justify-center rounded-full border border-line bg-panel text-sm leading-none text-ink-2 shadow-sm hover:border-danger hover:text-danger">×</button>
          <div className="absolute bottom-2.5 left-1/2 z-10 flex -translate-x-1/2 items-center gap-0.5 rounded-full border border-line bg-panel p-0.5 shadow-sm" role="group" aria-label={`${w.title} size`}>
            {slot.size !== "S" && <span className="px-2 text-[12px] font-medium text-ink-2">{w.title}</span>}
            {w.sizes.map((s) => (
              <button key={s} type="button" onClick={() => onSize(s)} title={SIZE_NAMES[s]} aria-pressed={slot.size === s}
                className={`h-6 min-w-6 rounded-full px-1.5 text-[12px] font-medium tabular-nums ${slot.size === s ? "bg-ink text-panel" : "text-ink-2 hover:bg-ink/[0.06]"}`}>
                {s}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export function HomeBoard({ initial, views, title, actions }: { initial: Slot[]; views: WidgetViews; title: ReactNode; actions: ReactNode }) {
  const [layout, setLayout] = useState<Slot[]>(initial);
  const [editing, setEditing] = useState(false);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const visible = layout.filter((s) => !s.hidden);
  const hidden = layout.filter((s) => s.hidden);

  // Widgets say different things depending on what else is on screen (the
  // week card drops its "Today" line when the Today widget is there), so the
  // server re-renders them once the layout is saved.
  const router = useRouter();
  const update = (next: Slot[]) => { setLayout(next); void save(next).then(() => router.refresh()); };
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = layout.findIndex((s) => s.id === active.id);
    const to = layout.findIndex((s) => s.id === over.id);
    update(arrayMove(layout, from, to));
  };
  const patch = (id: WidgetId, change: Partial<Slot>) => update(layout.map((s) => (s.id === id ? { ...s, ...change } : s)));
  const reset = () => { setLayout(DEFAULT_LAYOUT.map((s) => ({ ...s }))); void fetch("/api/home-layout", { method: "DELETE" }).then(() => router.refresh()).catch(() => {}); };

  return (
    <div className="flex flex-col gap-3">
      {/* The page header: the date and sync on the left, the two things you
          can do to the whole page on the right. */}
      <header className="mb-4 flex items-start justify-between gap-4 sm:mb-6">
        <div className="min-w-0 flex-1">{title}</div>
        {/* Icons on a phone, words from tablet width up. */}
        <div className="flex shrink-0 items-center gap-2">
          {actions}
          <button type="button" onClick={() => setEditing((e) => !e)} aria-pressed={editing} aria-label={editing ? "Done editing home" : "Edit home"} title="Edit home"
            className={`inline-flex h-9 min-w-9 items-center justify-center gap-2 rounded-md border px-2.5 text-[13px] font-medium transition-colors sm:px-3 ${editing ? "border-accent bg-accent-soft text-accent" : "border-line-2 bg-panel text-ink hover:border-ink-3"}`}>
            {editing ? "Done" : (
              <>
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M4 20h4L19 9l-4-4L4 16v4Z" /><path d="m13.5 6.5 4 4" /></svg>
                <span className="hidden sm:inline">Edit home</span>
              </>
            )}
          </button>
        </div>
      </header>
      <div className={`flex-wrap items-center justify-end gap-2 ${editing ? "flex" : "hidden"}`}>
        {editing && (
          <>
            <span className="mr-auto text-[13px] text-ink-3">Drag to move · pick a size · × to remove</span>
            {hidden.map((s) => (
              <button key={s.id} type="button" onClick={() => patch(s.id, { hidden: false })}
                className="h-8 rounded-full border border-dashed border-line-2 px-3 text-[13px] text-ink-2 hover:border-accent hover:text-accent">
                + {WIDGETS[s.id].title}
              </button>
            ))}
            <button type="button" onClick={reset} className="h-8 rounded-md px-2 text-[13px] text-ink-3 hover:text-ink">Reset</button>
          </>
        )}
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={visible.map((s) => s.id)} strategy={rectSortingStrategy}>
          <div className="grid grid-flow-row-dense grid-cols-2 gap-x-3 gap-y-4 md:grid-cols-4">
            {visible.map((s) => (
              <Tile key={s.id} slot={s} view={views[s.id][s.size]} editing={editing}
                onSize={(size) => patch(s.id, { size })} onHide={() => patch(s.id, { hidden: true })} />
            ))}
          </div>
        </SortableContext>
      </DndContext>
      {visible.length === 0 && !editing && <p className="text-sm text-ink-3">Your home is empty. Press Edit home to add widgets.</p>}
    </div>
  );
}
