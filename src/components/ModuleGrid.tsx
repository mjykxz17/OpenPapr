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

function Tile({ m }: { m: Module }) {
  // Only `listeners` (pointer drag handlers) are spread — not `attributes`,
  // which would stamp role="button" and clobber the tile's link semantics.
  const { listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: m.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : undefined,
  };

  return (
    <Link
      ref={setNodeRef}
      href={`/modules/${m.id}`}
      draggable={false}
      style={style}
      {...listeners}
      className={`flex touch-none flex-col justify-between rounded-xl border border-line bg-surface p-4 no-underline select-none ${
        isDragging ? "cursor-grabbing scale-[1.03] shadow-lg" : "cursor-grab hover:border-ink-3"
      } transition-shadow`}
    >
      <div>
        <div className="text-sm font-medium text-ink">{m.code}</div>
        <div className="mt-0.5 line-clamp-2 text-xs text-ink-2">{m.name}</div>
      </div>
      <div className="mt-3 truncate text-xs tabular-nums text-ink-3">{summary(m)}</div>
    </Link>
  );
}

export function ModuleGrid({ modules }: { modules: Module[] }) {
  const [items, setItems] = useState(modules);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  function onDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    const from = items.findIndex((m) => m.id === active.id);
    const to = items.findIndex((m) => m.id === over.id);
    const next = arrayMove(items, from, to);
    setItems(next);
    void fetch("/api/modules/order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: next.map((m) => m.id) }),
    }).catch(() => {});
  }

  if (items.length === 0) return <p className="text-sm text-ink-3">No modules yet.</p>;

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={items.map((m) => m.id)} strategy={rectSortingStrategy}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {items.map((m) => (
            <Tile key={m.id} m={m} />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}
