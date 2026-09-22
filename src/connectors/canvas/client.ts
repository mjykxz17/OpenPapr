import type {
  CanvasAnnouncement, CanvasAssignmentGroup, CanvasCalendarEvent,
  CanvasCourse, CanvasFile, CanvasPage, CanvasSelf,
} from "./types";

function nextLink(header: string | null): string | null {
  if (!header) return null;
  for (const part of header.split(",")) {
    const m = part.match(/<([^>]+)>;\s*rel="next"/);
    if (m) return m[1];
  }
  return null;
}

export const isPdfFile = (f: CanvasFile): boolean =>
  f["content-type"] === "application/pdf" || /\.pdf$/i.test(f.display_name);

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
    // Identity check. Doubles as token validation at sign-in: a bad or revoked
    // token fails here before any account is created.
    getSelf: () => getOne<CanvasSelf>("/users/self"),
    listActiveCourses: () =>
      getAllPages<CanvasCourse>("/courses?enrollment_state=active&per_page=100&include[]=term&include[]=syllabus_body"),
    listAssignmentGroups: (courseId: number) =>
      getAllPages<CanvasAssignmentGroup>(`/courses/${courseId}/assignment_groups?include[]=assignments&include[]=submission&per_page=100`),
    listAnnouncements: (courseId: number) =>
      getAllPages<CanvasAnnouncement>(`/courses/${courseId}/discussion_topics?only_announcements=true&per_page=50`),
    listCalendarEvents: (courseId: number) =>
      getAllPages<CanvasCalendarEvent>(`/calendar_events?type=event&context_codes[]=course_${courseId}&per_page=100&all_events=true`),
    listPages: (courseId: number) => getAllPages<CanvasPage>(`/courses/${courseId}/pages?per_page=100`),
    getPageBody: async (courseId: number, slug: string) =>
      (await getOne<{ body: string | null }>(`/courses/${courseId}/pages/${encodeURIComponent(slug)}`)).body ?? "",
    listSyllabusFiles: (courseId: number) =>
      getAllPages<CanvasFile>(`/courses/${courseId}/files?search_term=syllabus&per_page=50`),
    // Resolves one file by id. This is how hidden files are reached: they are
    // absent from the course listing but fetch fine when asked for directly,
    // and the response carries a freshly signed download url.
    getFile: (fileId: number) => getOne<CanvasFile>(`/files/${fileId}`),
    // Every course the student is or was in, for their study history.
    listCourseHistory: async () => {
      const [active, completed] = await Promise.all([
        getAllPages<CanvasCourse>("/courses?enrollment_state=active&per_page=100&include[]=term"),
        getAllPages<CanvasCourse>("/courses?enrollment_state=completed&per_page=100&include[]=term"),
      ]);
      return [
        ...active.map((c) => ({ ...c, historyState: "active" as const })),
        ...completed.map((c) => ({ ...c, historyState: "completed" as const })),
      ];
    },
    listCourseTeachers: (courseId: number) =>
      getAllPages<{ id: number; name: string; short_name?: string }>(`/courses/${courseId}/users?enrollment_type[]=teacher&per_page=50`),
    listCourseFiles: (courseId: number) =>
      getAllPages<CanvasFile>(`/courses/${courseId}/files?per_page=100&sort=created_at`),
    downloadFile: async (url: string) => {
      const res = await fetchFn(url, { headers });
      if (!res.ok) throw new Error(`Canvas file ${res.status}`);
      return new Uint8Array(await res.arrayBuffer());
    },
  };
}
export type CanvasClient = ReturnType<typeof createCanvasClient>;
