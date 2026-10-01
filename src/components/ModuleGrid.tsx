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
import { shortComponentName } from "@/lib/module-name";

type Module = Overview["modules"][number];

const GRID = "grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3";
// Every tile is the same size whatever its module holds: the name is one
// line, the weighting table always takes four rows, and "Next" sits on the
// bottom edge. A tidy grid beats squeezing in every detail.
const CARD = "flex h-[258px] flex-col gap-3.5 rounded-[10px] border border-line bg-panel px-[18px] py-4 no-underline select-none";
const ROWS = 4;
const ROW_COLORS = ["bg-accent", "bg-seg-2", "bg-seg-3", "bg-seg-4"] as const;

// Up to four rows: the biggest components, the rest folded into "Other",
// and whatever the syllabus leaves unaccounted.
function weightRows(m: Module) {
  const segs = weightSegments(m.components).map((s) => ({ name: shortComponentName(s.name), full: s.name, pct: s.pct, warn: false }));
  const room = m.unaccountedPct != null && m.unaccountedPct > 0 ? ROWS - 1 : ROWS;
  const rows = segs.length > room
    ? [...segs.slice(0, room - 1), { name: "Other", full: segs.slice(room - 1).map((s) => s.full).join(", "), pct: segs.slice(room - 1).reduce((n, s) => n + s.pct, 0), warn: false }]
    : segs;
  if (room < ROWS) rows.push({ name: "Unaccounted", full: "Not found in the syllabus yet", pct: m.unaccountedPct!, warn: true });
  return rows;
}

function TileFace({ m }: { m: Module }) {
  const rows = weightRows(m);
  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[15px] font-semibold text-ink">{m.code}</div>
          <div className="truncate text-[13px] text-ink-2" title={m.name}>{m.shortName}</div>
        </div>
        {m.newCount > 0 && <span className="shrink-0 pt-0.5 text-[12px] font-medium text-accent">{m.newCount} new</span>}
      </div>
      <WeightBar components={m.components} />
      {rows.length === 0 ? (
        <div className="flex h-[88px] flex-col justify-center gap-1 text-[13px] text-ink-3">
          <span>Weighting not found yet</span>
          <span className="font-medium text-accent">Add it on the module page</span>
        </div>
      ) : (
        <ul className="grid h-[88px] content-start gap-y-[5px] text-[13px] tabular-nums">
          {rows.map((r, i) => (
            <li key={r.name} className="grid grid-cols-[8px_minmax(0,1fr)_auto] items-center gap-2" title={r.full}>
              <span className={`h-2 w-2 rounded-[2px] ${r.warn ? "border border-dashed border-warn-ink" : ROW_COLORS[i] ?? "bg-seg-4"}`} />
              <span className={`truncate ${r.warn ? "text-warn-ink" : "text-ink"}`}>{r.name}</span>
              <span className={r.warn ? "text-warn-ink" : "text-ink-3"}>{r.pct}%</span>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-auto flex items-baseline gap-3 border-t border-line pt-2.5 text-[13px]">
        <span className="shrink-0 text-ink-3">Next</span>
        {m.next ? (
          <span className="ml-auto flex min-w-0 items-baseline gap-1" title={`${m.next.title} · ${m.next.when}`}>
            <span className="truncate font-medium text-ink">{m.next.title}</span>
            <span className="shrink-0 text-ink-2">· {m.next.when}</span>
          </span>
        ) : (
          <span className="ml-auto text-ink-3">Nothing due</span>
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
            {editing ? "Done" : "Arrange modules"}
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
