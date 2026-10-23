// Links out to Canvas make sense only for a real Canvas course. The demo's
// courses are made up (their ids would land on someone else's course, or
// none, on the real NUS Canvas), and a module the student made has no course.
export function showCanvasLinks(user: { isDemo: boolean } | null | undefined, canvasCourseId: number): boolean {
  return !user?.isDemo && canvasCourseId > 0;
}
