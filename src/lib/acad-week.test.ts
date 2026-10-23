import { describe, expect, it } from "vitest";
import { acadYearStart, semesterView } from "./acad-week";

const sgt = (d: string, t = "12:00") => Date.parse(`${d}T${t}:00+08:00`);
const day = (ms: number) => new Date(ms + 8 * 3_600_000).toISOString().slice(0, 10);

describe("NUS academic calendar", () => {
  it("starts the year on the first Monday on or after 1 August", () => {
    expect(day(acadYearStart(2026))).toBe("2026-08-03");
    expect(day(acadYearStart(2025))).toBe("2025-08-04");
  });

  it("matches the Registrar's AY2026/27 dates", () => {
    expect(semesterView(sgt("2026-08-05")).title).toBe("Orientation week");
    expect(semesterView(sgt("2026-08-10", "00:01")).title).toBe("Week 1");
    expect(semesterView(sgt("2026-09-23")).title).toBe("Recess week");
    expect(semesterView(sgt("2026-10-03"))).toMatchObject({ title: "Week 7", weekOf: 13, sem: 1, year: "26/27" });
    expect(semesterView(sgt("2026-11-13")).title).toBe("Week 13");
    expect(semesterView(sgt("2026-11-17")).title).toBe("Reading week");
    expect(semesterView(sgt("2026-11-24")).title).toBe("Exam week 1");
    expect(day(semesterView(sgt("2026-10-03")).examsFrom)).toBe("2026-11-21");
    expect(day(semesterView(sgt("2026-10-03")).readingFrom)).toBe("2026-11-14");
    const v = semesterView(sgt("2026-12-20"));
    expect(v.phase).toBe("vacation");
    expect(day(v.nextSemStart!)).toBe("2027-01-11");
    expect(semesterView(sgt("2027-01-11", "09:00"))).toMatchObject({ title: "Week 1", sem: 2 });
  });

  it("places today on the semester bar", () => {
    const v = semesterView(sgt("2026-10-03"));
    expect(v.progress).toBeGreaterThan(0.4);
    expect(v.progress).toBeLessThan(0.5);
    expect(v.marks.recess[0]).toBeCloseTo(6 / 17, 5);
    expect(v.marks.exams[0]).toBeCloseTo(15 / 17, 5);
  });

  it("knows the summer break leads to next year's Semester 1", () => {
    const v = semesterView(sgt("2027-06-01"));
    expect(v.phase).toBe("vacation");
    expect(day(v.nextSemStart!)).toBe("2027-08-09");
  });
});

describe("semesterWeeks", () => {
  it("lists the semester's weeks with their Mondays", async () => {
    const { semesterWeeks } = await import("./acad-week");
    const { weeks } = semesterWeeks(sgt("2026-10-03"));
    const by = Object.fromEntries(weeks.map((w) => [w.label, day(w.monday)]));
    expect(by["Week 1"]).toBe("2026-08-10");
    expect(by["Recess week"]).toBe("2026-09-21");
    expect(by["Week 8"]).toBe("2026-10-05");
    expect(by["Week 13"]).toBe("2026-11-09");
    expect(by["Exam week 2"]).toBe("2026-11-30");
    expect(weeks.find((w) => w.label === "Week 8")!.teachingWeek).toBe(8);
  });
});

describe("semesterWeeks in a vacation", () => {
  it("maps weeks to the semester coming up, not the one just finished", async () => {
    const { semesterWeeks } = await import("./acad-week");
    const dec = semesterWeeks(sgt("2026-12-20"));
    expect(dec).toMatchObject({ sem: 2, year: "26/27" });
    const by = Object.fromEntries(dec.weeks.map((w) => [w.label, day(w.monday)]));
    expect(by["Week 1"]).toBe("2027-01-11");
    expect(by["Week 3"]).toBe("2027-01-25");
    // Right after exams too, and on the last vacation day.
    expect(day(semesterWeeks(sgt("2026-12-07", "09:00")).weeks[0]!.monday)).toBe("2027-01-11");
    expect(day(semesterWeeks(sgt("2027-01-03", "23:00")).weeks[0]!.monday)).toBe("2027-01-11");
    // Still in exams: this semester's weeks.
    expect(day(semesterWeeks(sgt("2026-12-01")).weeks[0]!.monday)).toBe("2026-08-10");
  });

  it("leads the May–August break (and its special terms) to next year's Semester 1", async () => {
    const { semesterWeeks } = await import("./acad-week");
    for (const d of ["2027-05-20", "2027-06-15", "2027-07-30", "2027-08-08"]) {
      const s = semesterWeeks(sgt(d));
      expect(s).toMatchObject({ sem: 1, year: "27/28" });
      expect(day(s.weeks[0]!.monday)).toBe("2027-08-09");
    }
    // Semester 2's exams are still Semester 2.
    expect(semesterWeeks(sgt("2027-05-05")).sem).toBe(2);
  });

  it("keeps a module to its own Canvas term", async () => {
    const { semesterWeeks, termSemester } = await import("./acad-week");
    expect(termSemester("[2610] AY2026/27 Semester 1")).toEqual({ startYear: 2026, sem: 1 });
    expect(termSemester("[2630] Special Term I")).toBeNull();
    expect(termSemester(null)).toBeNull();
    // A Semester 1 module looked at in December: its weeks stay in August–November.
    const s1 = semesterWeeks(sgt("2026-12-20"), "[2610] AY2026/27 Semester 1");
    expect(s1.sem).toBe(1);
    expect(day(s1.weeks.find((w) => w.label === "Week 3")!.monday)).toBe("2026-08-24");
    const s2 = semesterWeeks(sgt("2026-10-03"), "[2620] AY2026/27 Semester 2");
    expect(day(s2.weeks[0]!.monday)).toBe("2027-01-11");
    // Unknown or special terms fall back to the date.
    expect(day(semesterWeeks(sgt("2026-12-20"), "[2630] ST I").weeks[0]!.monday)).toBe("2027-01-11");
  });
});
