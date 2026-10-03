import type { SemesterView } from "@/lib/acad-week";

// The semester as one thin bar: teaching weeks, with recess, reading week and
// exams marked, and a tick for today. Server-rendered from the date alone.
export function SemesterBar({ v }: { v: SemesterView }) {
  if (v.progress === null) return null;
  const pct = (x: number) => `${(x * 100).toFixed(2)}%`;
  const seg = (from: number, to: number, cls: string) => (
    <span className={`absolute inset-y-0 ${cls}`} style={{ left: pct(from), width: pct(to - from) }} />
  );
  return (
    <div className="relative mt-5 h-8 w-full max-w-[520px]" role="img"
      aria-label={`${v.title}, ${Math.round(v.progress * 100)}% through Semester ${v.sem}`}>
      <span className="absolute -top-2 text-[10.5px] text-ink-3" style={{ left: pct(v.marks.recess[0]), transform: "translateX(-25%)" }}>Recess</span>
      <span className="absolute -top-2 text-[10.5px] text-ink-3" style={{ left: pct(v.marks.reading[0]), transform: "translateX(-60%)" }}>Reading</span>
      <div className="absolute inset-x-0 top-[10px] h-1.5 overflow-hidden rounded-full bg-seg-3/70">
        {/* What has passed is solid; the rest is the track. */}
        <span className="absolute inset-y-0 left-0 bg-accent/80" style={{ width: pct(v.progress) }} />
        {seg(v.marks.recess[0], v.marks.recess[1], "bg-ink-3/60")}
        {seg(v.marks.reading[0], v.marks.reading[1], "bg-ink-3/60")}
        {seg(v.marks.exams[0], v.marks.exams[1], "bg-danger/60")}
      </div>
      <span className="absolute top-[5px] h-4 w-[2px] -translate-x-1/2 rounded-full bg-ink" style={{ left: pct(v.progress) }} />
      <span className="absolute top-5 left-0 text-[10.5px] text-ink-3">Week 1</span>
      <span className="absolute top-5 right-0 text-[10.5px] text-ink-3">Exams</span>
    </div>
  );
}
