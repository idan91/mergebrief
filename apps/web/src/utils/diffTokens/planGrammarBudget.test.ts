import { describe, expect, it } from "vitest";

import { planGrammarBudget } from "./planGrammarBudget";
import { GRAMMAR_BUDGET_BYTES, GRAMMAR_GZIP_BYTES } from "./consts";
import { GrammarNames, type FileGrammarRows } from "./types";

function makeFile(
  grammar: FileGrammarRows["grammar"],
  rowCount: number,
): FileGrammarRows {
  return { grammar, rowCount };
}

const TSX_BYTES = GRAMMAR_GZIP_BYTES[GrammarNames.TSX];
const JSON_BYTES = GRAMMAR_GZIP_BYTES[GrammarNames.JSON];

describe("planGrammarBudget", () => {
  it("admits grammars in descending row order", () => {
    const plan = planGrammarBudget(
      [makeFile(GrammarNames.JSON, 5), makeFile(GrammarNames.TSX, 90)],
      TSX_BYTES + JSON_BYTES,
    );

    expect(plan.admitted).toEqual([GrammarNames.TSX, GrammarNames.JSON]);
    expect(plan.spentBytes).toBe(TSX_BYTES + JSON_BYTES);
  });

  it("sums the rows a grammar holds across files", () => {
    const plan = planGrammarBudget(
      [
        makeFile(GrammarNames.JSON, 40),
        makeFile(GrammarNames.TSX, 20),
        makeFile(GrammarNames.TSX, 30),
      ],
      TSX_BYTES + JSON_BYTES,
    );

    expect(plan.admitted).toEqual([GrammarNames.TSX, GrammarNames.JSON]);
  });

  it("admits a grammar that spends the budget exactly", () => {
    const plan = planGrammarBudget([makeFile(GrammarNames.TSX, 9)], TSX_BYTES);

    expect(plan.admitted).toEqual([GrammarNames.TSX]);
    expect(plan.spentBytes).toBe(TSX_BYTES);
  });

  it("skips a grammar that does not fit and admits the next one", () => {
    const plan = planGrammarBudget(
      [makeFile(GrammarNames.ASTRO, 90), makeFile(GrammarNames.JSON, 5)],
      JSON_BYTES,
    );

    expect(plan.admitted).toEqual([GrammarNames.JSON]);
    expect(plan.spentBytes).toBe(JSON_BYTES);
  });

  it("never admits a grammar with no rows", () => {
    const plan = planGrammarBudget(
      [makeFile(GrammarNames.TSX, 0), makeFile(GrammarNames.JSON, 3)],
      TSX_BYTES + JSON_BYTES,
    );

    expect(plan.admitted).toEqual([GrammarNames.JSON]);
  });

  it("returns an empty plan for no files", () => {
    expect(planGrammarBudget([], TSX_BYTES)).toEqual({
      admitted: [],
      spentBytes: 0,
    });
  });

  it("fits the grammars a typical brief touches inside the budget", () => {
    const plan = planGrammarBudget(
      [
        makeFile(GrammarNames.TSX, 900),
        makeFile(GrammarNames.TYPESCRIPT, 800),
        makeFile(GrammarNames.SCSS, 400),
        makeFile(GrammarNames.MARKDOWN, 200),
        makeFile(GrammarNames.JSON, 100),
      ],
      GRAMMAR_BUDGET_BYTES,
    );

    expect(plan.admitted).toEqual([
      GrammarNames.TSX,
      GrammarNames.TYPESCRIPT,
      GrammarNames.SCSS,
      GrammarNames.MARKDOWN,
      GrammarNames.JSON,
    ]);
    expect(plan.spentBytes).toBeLessThanOrEqual(GRAMMAR_BUDGET_BYTES);
  });

  it("orders grammars with equal row counts by name", () => {
    const plan = planGrammarBudget(
      [makeFile(GrammarNames.TSX, 7), makeFile(GrammarNames.JSON, 7)],
      TSX_BYTES + JSON_BYTES,
    );

    expect(plan.admitted).toEqual([GrammarNames.JSON, GrammarNames.TSX]);
  });
});
