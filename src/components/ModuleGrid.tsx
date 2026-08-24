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

type Module = Overview["modules"][number];

// A compact one-line weightage summary for the tile face.
function summary(m: Module): string {
  const withPct = m.components.filter((c) => c.weightPct != null);
  if (withPct.length === 0) return "weightage unknown";
  return withPct
    .slice(0, 4)
    .map((c) => `${c.name} ${c.weightPct}`)
    .join(" · ");
}

const GRID = "grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4";
const CARD = "flex flex-col justify-between rounded-xl border border-line bg-surface p-4 no-underline select-none";

function TileFace({ m }: { m: Module }) {
  return (
    <>
      <div>
        <div className="text-sm font-medium text-ink">{m.code}</div>
        <div className="mt-0.5 line-clamp-2 text-xs text-ink-2">{m.name}</div>
      </div>
      <div className="mt-3 truncate text-xs tabular-nums text-ink-3">{summary(m)}</div>
    </>
  );
}

// Normal mode: the tile is a plain link that opens the module.
function StaticTile({ m }: { m: Module }) {
  return (
    <Link href={`/modules/${m.id}`} className={`${CARD} transition-shadow hover:border-ink-3`}>
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
        className="absolute -left-2 -top-2 z-20 flex h-5 w-5 items-center justify-center rounded-full border border-line bg-surface text-xs leading-none text-ink-2 shadow-sm hover:border-danger hover:text-danger"
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

  if (items.length === 0) return <p className="text-sm text-ink-3">No modules yet.</p>;

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs text-ink-3">{editing ? "Drag to reorder · × to hide" : ""}</span>
        <button
          type="button"
          onClick={() => setEditing((e) => !e)}
          aria-pressed={editing}
          className={`rounded border px-2.5 py-1 text-xs transition-colors ${
            editing ? "border-accent text-accent" : "border-line text-ink-2 hover:border-ink-3 hover:text-ink"
          }`}
        >
          {editing ? "Done" : "Edit"}
        </button>
      </div>

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
            <div className="mt-8">
              <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-3">Hidden</h2>
              <ul className="flex flex-wrap gap-2">
                {hidden.map((m) => (
                  <li key={m.id}>
                    <button
                      type="button"
                      onClick={() => setHidden(m.id, false)}
                      className="flex items-center gap-1.5 rounded-full border border-line px-3 py-1 text-xs text-ink-2 hover:border-accent hover:text-accent"
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
    </div>
  );
}
