// The line under the semester bar. It speaks of deadlines only, so it never
// reads as "nothing to do" right above a Today card full of study steps.
export function todayLine(dueToday: number): string {
  if (dueToday <= 0) return "No deadlines today";
  return dueToday === 1 ? "1 deadline today" : `${dueToday} deadlines today`;
}
