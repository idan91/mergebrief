import { describe, expect, it } from "vitest";
import { proseLengthNotes } from "../eval/length";

const over = (field: string, actual: number) => ({
  surface: "group-summary" as const,
  field,
  actual,
  cap: 250,
});

describe("proseLengthNotes (BRIEF-148)", () => {
  it("is silent when no run carries violations", () => {
    expect(proseLengthNotes([{}, { lengthViolations: [] }])).toEqual([]);
  });

  it("rolls runs into one note with the worst overshoot", () => {
    const notes = proseLengthNotes([
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
      "prose length: 2/3 runs over cap, 3 violation(s) — worst: group g3 summary 412/250 chars",
    ]);
  });

  it("prefixes the label for pair-case sides", () => {
    const notes = proseLengthNotes(
      [{ lengthViolations: [over("group g1 summary", 300)] }],
      "revised",
    );
    expect(notes[0]).toMatch(/^revised prose length: 1\/1 runs/);
  });
});
