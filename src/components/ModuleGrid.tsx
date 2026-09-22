"use client";

import { useState } from "react";
import Link from "next/link";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, rectSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Overview } from "@/server/overview";
import { WeightBar, weightSegments } from "@/components/WeightBar";

type Module = Overview["modules"][number];

const GRID = "grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3";
const CARD = "flex flex-col gap-3.5 rounded-[10px] border border-line bg-panel px-[18px] py-4 no-underline select-none";

// The tile face: code and name, then the weighting as a bar with a legend
// beneath it — every component named, none truncated. A module with no
// known weighting says so and points at the fix.
function TileFace({ m }: { m: Module }) {
  const segments = weightSegments(m.components);
  return (
    <>
      <div className="flex flex-col gap-0.5">
        <div className="text-[15px] font-semibold text-ink">{m.code}</div>
        <div className="line-clamp-2 text-[13px] text-ink-2">{m.name}</div>
      </div>
      <div className="flex flex-col gap-2">
        <WeightBar components={m.components} />
        {segments.length === 0 ? (
          <div className="flex gap-3 text-[13px] text-ink-3">
            <span>Weighting not found yet</span>
            <span className="font-medium text-accent">Add it</span>
          </div>
        ) : (
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-[13px] tabular-nums text-ink-2">
            {segments.map((s) => (
              <span key={s.name}>
                {s.name} {s.pct}
              </span>
            ))}
            {m.unaccountedPct != null && m.unaccountedPct > 0 && (
              <span className="text-warn-ink">Unaccounted {m.unaccountedPct}</span>
            )}
          </div>
        )}
      </div>
    </>
  );
}

// Normal mode: the tile is a plain link that opens the module.
function StaticTile({ m }: { m: Module }) {
  return (
    <Link href={`/modules/${m.id}`} className={`${CARD} transition-colors hover:border-line-2`}>
      <TileFace m={m} />
    </Link>
  );
}

// Edit mode: the tile is draggable (and jiggles), and carries a hide (×) badge.
// Clicking the body does nothing so a rearrange never accidentally navigates.
function SortableTile({ m, onHide }: { m: Module; onHide: (id: number) => void }) {
  const { listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: m.id });
  const style = { transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 10 : undefined };
  return (
    <div className="relative">
      <div
        ref={setNodeRef}
        style={style}
        {...listeners}
        className={`${CARD} touch-none ${
          isDragging ? "z-10 scale-[1.03] cursor-grabbing shadow-lg" : "tile-wobble cursor-grab border-ink-3"
        }`}
      >
        <TileFace m={m} />
      </div>
      <button
        type="button"
        aria-label={`Hide ${m.code}`}
        title="Hide from home"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => onHide(m.id)}
        className="absolute -left-2.5 -top-2.5 z-20 flex h-6 w-6 items-center justify-center rounded-full border border-line bg-panel text-sm leading-none text-ink-2 shadow-sm hover:border-danger hover:text-danger"
      >
        ×
      </button>
    </div>
  );
}

export function ModuleGrid({ modules }: { modules: Module[] }) {
  const [items, setItems] = useState(modules);
  const [editing, setEditing] = useState(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  const visible = items.filter((m) => !m.hidden);
  const hidden = items.filter((m) => m.hidden);

  function persistOrder(next: Module[]) {
    void fetch("/api/modules/order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: next.map((m) => m.id) }),
    }).catch(() => {});
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    const from = items.findIndex((m) => m.id === active.id);
    const to = items.findIndex((m) => m.id === over.id);
    const next = arrayMove(items, from, to);
    setItems(next);
    persistOrder(next);
  }

  function setHidden(id: number, hide: boolean) {
    setItems((prev) => prev.map((m) => (m.id === id ? { ...m, hidden: hide } : m)));
    void fetch(`/api/modules/${id}/hidden`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hidden: hide }),
    }).catch(() => {});
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <h2 className="text-[13px] font-semibold uppercase tracking-[0.06em] text-ink-2">
          Modules{editing && <span className="ml-3 font-normal normal-case tracking-normal text-ink-3">Drag to reorder · × to hide</span>}
        </h2>
        {items.length > 0 && (
          <button
            type="button"
            onClick={() => setEditing((e) => !e)}
            aria-pressed={editing}
            className={`h-8 rounded-md border px-3 text-[13px] font-medium transition-colors ${
              editing ? "border-accent bg-accent-soft text-accent" : "border-line-2 bg-panel text-ink hover:border-ink-3"
            }`}
          >
            {editing ? "Done" : "Edit layout"}
          </button>
        )}
      </div>

      {items.length === 0 && <p className="text-sm text-ink-3">No modules yet — run a sync to pull them from Canvas.</p>}

      {editing ? (
        <>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={visible.map((m) => m.id)} strategy={rectSortingStrategy}>
              <div className={GRID}>
                {visible.map((m) => (
                  <SortableTile key={m.id} m={m} onHide={(id) => setHidden(id, true)} />
                ))}
              </div>
            </SortableContext>
          </DndContext>

          {hidden.length > 0 && (
            <div className="mt-5">
              <h3 className="mb-2 text-[13px] font-semibold uppercase tracking-[0.06em] text-ink-2">Hidden</h3>
              <ul className="flex flex-wrap gap-2">
                {hidden.map((m) => (
                  <li key={m.id}>
                    <button
                      type="button"
                      onClick={() => setHidden(m.id, false)}
                      className="flex h-8 items-center gap-1.5 rounded-md border border-line-2 bg-panel px-3 text-[13px] text-ink-2 hover:border-accent hover:text-accent"
                    >
                      <span>{m.code}</span>
                      <span className="text-ink-3">+ show</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      ) : (
        <div className={GRID}>
          {visible.map((m) => (
            <StaticTile key={m.id} m={m} />
          ))}
        </div>
      )}
    </section>
  );
}
