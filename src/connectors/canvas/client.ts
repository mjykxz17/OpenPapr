import type {
  CanvasAnnouncement, CanvasAssignmentGroup, CanvasCalendarEvent,
  CanvasCourse, CanvasFile, CanvasPage,
} from "./types";

function nextLink(header: string | null): string | null {
  if (!header) return null;
  for (const part of header.split(",")) {
    const m = part.match(/<([^>]+)>;\s*rel="next"/);
    if (m) return m[1];
  }
  return null;
}

export function createCanvasClient(baseUrl: string, token: string, fetchFn: typeof fetch = fetch) {
  const headers = { Authorization: `Bearer ${token}` };

  async function getAllPages<T>(path: string): Promise<T[]> {
    let url: string | null = `${baseUrl}/api/v1${path}`;
    const out: T[] = [];
    while (url) {
      const res: Response = await fetchFn(url, { headers });
      if (!res.ok) throw new Error(`Canvas ${res.status} on ${url}: ${await res.text()}`);
      out.push(...((await res.json()) as T[]));
      url = nextLink(res.headers.get("link"));
    }
    return out;
  }

  async function getOne<T>(path: string): Promise<T> {
    const res = await fetchFn(`${baseUrl}/api/v1${path}`, { headers });
    if (!res.ok) throw new Error(`Canvas ${res.status} on ${path}: ${await res.text()}`);
    return (await res.json()) as T;
  }

  return {
    listActiveCourses: () =>
      getAllPages<CanvasCourse>("/courses?enrollment_state=active&per_page=100&include[]=term&include[]=syllabus_body"),
    listAssignmentGroups: (courseId: number) =>
      getAllPages<CanvasAssignmentGroup>(`/courses/${courseId}/assignment_groups?include[]=assignments&include[]=submission&per_page=100`),
    listAnnouncements: (courseId: number) =>
      getAllPages<CanvasAnnouncement>(`/courses/${courseId}/discussion_topics?only_announcements=true&per_page=50`),
    listCalendarEvents: (courseId: number) =>
      getAllPages<CanvasCalendarEvent>(`/calendar_events?type=event&context_codes[]=course_${courseId}&per_page=100`),
    listPages: (courseId: number) => getAllPages<CanvasPage>(`/courses/${courseId}/pages?per_page=100`),
    getPageBody: async (courseId: number, slug: string) =>
      (await getOne<{ body: string | null }>(`/courses/${courseId}/pages/${encodeURIComponent(slug)}`)).body ?? "",
    listSyllabusFiles: (courseId: number) =>
      getAllPages<CanvasFile>(`/courses/${courseId}/files?search_term=syllabus&per_page=50`),
    downloadFile: async (url: string) => {
      const res = await fetchFn(url, { headers });
      if (!res.ok) throw new Error(`Canvas file ${res.status}`);
      return new Uint8Array(await res.arrayBuffer());
    },
  };
}
export type CanvasClient = ReturnType<typeof createCanvasClient>;
