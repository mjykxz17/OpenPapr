import { describe, expect, it } from "vitest";
import { splitForEllipsis } from "./middle-ellipsis";

describe("splitForEllipsis", () => {
  it("keeps the end of a long name, where files tend to differ", () => {
    const [head, tail] = splitForEllipsis("Lecture 03 - Memory Errors and Debugging Part 2.pdf");
    expect(tail).toBe("ing Part 2.pdf");
    expect(head + tail).toBe("Lecture 03 - Memory Errors and Debugging Part 2.pdf");
  });
  it("leaves a short name whole", () => {
    expect(splitForEllipsis("L3.pdf")).toEqual(["L3.pdf", ""]);
    expect(splitForEllipsis("Tutorial 4 answers.pdf")).toEqual(["Tutorial 4 answers.pdf", ""]);
  });
});
