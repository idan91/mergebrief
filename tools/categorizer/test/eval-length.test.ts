import { describe, expect, it } from "vitest";
import { textLengthNotes } from "../eval/length";

const over = (field: string, actual: number) => ({
  surface: "group-summary" as const,
  field,
  actual,
  cap: 250,
});

describe("textLengthNotes", () => {
  it("is silent when no run carries violations", () => {
    expect(textLengthNotes([{}, { lengthViolations: [] }])).toEqual([]);
  });

  it("rolls runs into one note with the worst overshoot", () => {
    const notes = textLengthNotes([
      { lengthViolations: [over("group g1 summary", 300)] },
      {},
      {
        lengthViolations: [
          over("group g2 summary", 260),
          over("group g3 summary", 412),
        ],
      },
    ]);
    expect(notes).toEqual([
      "text length: 2/3 runs over cap, 3 violation(s) — worst: group g3 summary 412/250 chars",
    ]);
  });
});
