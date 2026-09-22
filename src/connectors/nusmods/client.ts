// Public module data from NUSMods, and the review comments students leave on
// NUSMods module pages (Disqus, forum "nusmods-prod", thread = module code).

export type NusmodsModule = {
  code: string;
  title: string;
  description: string;
  moduleCredit: string | null;
  department: string | null;
  faculty: string | null;
  workload: number[] | string | null;   // [lecture, tutorial, lab, project, prep] hours/week
  prerequisite: string | null;
  preclusion: string | null;
  corequisite: string | null;
  semesters: number[];
  examDates: string[];
};

export type Review = { text: string; createdAt: string; likes: number };

// NUS academic years begin in August: September 2026 is AY2026/27.
export function acadYearFor(ms: number): string {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const start = d.getUTCMonth() >= 6 ? y : y - 1; // July onwards counts as the new year: NUSMods publishes early
  return `${start}-${start + 1}`;
}

// Canvas course codes carry the NUS code, sometimes several ("IFS4103/IS4103")
// or with a suffix ("CS2103T [2610]").
export function moduleCodes(canvasCode: string): string[] {
  return [...new Set((canvasCode.toUpperCase().match(/\b[A-Z]{2,4}\d{4}[A-Z]{0,3}\b/g) ?? []))];
}

type RawModule = {
  moduleCode: string; title: string; description?: string; moduleCredit?: string;
  department?: string; faculty?: string; workload?: number[] | string;
  prerequisite?: string; preclusion?: string; corequisite?: string;
  semesterData?: { semester: number; examDate?: string }[];
};

export function trimModule(raw: RawModule): NusmodsModule {
  return {
    code: raw.moduleCode,
    title: raw.title,
    description: (raw.description ?? "").slice(0, 3000),
    moduleCredit: raw.moduleCredit ?? null,
    department: raw.department ?? null,
    faculty: raw.faculty ?? null,
    workload: raw.workload ?? null,
    prerequisite: raw.prerequisite ?? null,
    preclusion: raw.preclusion ?? null,
    corequisite: raw.corequisite ?? null,
    semesters: (raw.semesterData ?? []).map((s) => s.semester),
    examDates: (raw.semesterData ?? []).map((s) => s.examDate).filter((d): d is string => Boolean(d)),
  };
}

// The current year first, then the previous one: a module not offered this
// year still has last year's record.
export async function fetchNusmodsModule(code: string, now: number, fetchFn: typeof fetch = fetch):
  Promise<{ acadYear: string; module: NusmodsModule } | null> {
  const thisYear = acadYearFor(now);
  const [a] = thisYear.split("-").map(Number) as [number];
  for (const ay of [thisYear, `${a - 1}-${a}`]) {
    const res = await fetchFn(`https://api.nusmods.com/v2/${ay}/modules/${encodeURIComponent(code)}.json`,
      { signal: AbortSignal.timeout(15_000) });
    if (res.status === 404) continue;
    if (!res.ok) throw new Error(`NUSMods ${res.status}`);
    return { acadYear: ay, module: trimModule((await res.json()) as RawModule) };
  }
  return null;
}

type DisqusPost = { raw_message?: string; message?: string; createdAt?: string; likes?: number; isDeleted?: boolean; isSpam?: boolean };
type DisqusPage = { code: number; response: DisqusPost[] | string; cursor?: { hasNext?: boolean; next?: string } };

// Newest first, up to `max`. Only the text, date and like count are kept —
// who wrote a review is nobody's business here.
export async function fetchReviews(code: string, apiKey: string, max = 150, fetchFn: typeof fetch = fetch): Promise<Review[]> {
  const out: Review[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 3 && out.length < max; page++) {
    const q = new URLSearchParams({
      api_key: apiKey, forum: "nusmods-prod", "thread:ident": code, limit: "100", order: "desc",
    });
    if (cursor) q.set("cursor", cursor);
    const res = await fetchFn(`https://disqus.com/api/3.0/threads/listPosts.json?${q}`, { signal: AbortSignal.timeout(15_000) });
    const body = (await res.json().catch(() => null)) as DisqusPage | null;
    // Code 2 is "unable to find thread": a module nobody has reviewed.
    if (body?.code === 2) return out;
    if (!res.ok || !body || body.code !== 0 || !Array.isArray(body.response)) throw new Error(`Disqus ${res.status} code ${body?.code ?? "?"}`);
    for (const p of body.response) {
      if (p.isDeleted || p.isSpam) continue;
      const text = (p.raw_message ?? "").trim();
      if (text.length < 20) continue;
      out.push({ text: text.slice(0, 2500), createdAt: p.createdAt ?? "", likes: p.likes ?? 0 });
    }
    if (!body.cursor?.hasNext || !body.cursor.next) break;
    cursor = body.cursor.next;
  }
  return out.slice(0, max);
}

// What goes to the model: the most useful reviews within a character budget.
// Recent ones say how the module runs now; liked ones are the ones other
// students found accurate.
export function pickReviews(reviews: Review[], budget = 12_000, nowMs = Date.now()): Review[] {
  const scored = reviews.map((r) => {
    const ageYears = r.createdAt ? Math.max(0, (nowMs - Date.parse(r.createdAt)) / (365 * 86_400_000)) : 5;
    return { r, score: r.likes * 2 + Math.max(0, 6 - ageYears * 1.5) };
  }).sort((a, b) => b.score - a.score);
  const out: Review[] = [];
  let used = 0;
  for (const { r } of scored) {
    const t = r.text.slice(0, 1200);
    if (used + t.length > budget) continue;
    out.push({ ...r, text: t });
    used += t.length;
  }
  return out;
}
