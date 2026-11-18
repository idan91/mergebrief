import { describe, expect, it } from "vitest";

import { planGrammarBudget } from "./planGrammarBudget";
import {
  GRAMMAR_BUDGET_BYTES,
  GRAMMAR_MODULE_GZIP_BYTES,
  GRAMMAR_SIBLING_MODULES,
} from "./consts";
import { GrammarNames, type FileGrammarRows, type GrammarName } from "./types";

function makeFile(
  grammar: FileGrammarRows["grammar"],
  rowCount: number,
): FileGrammarRows {
  return { grammar, rowCount };
}

function sumClosureBytes(grammar: GrammarName): number {
  const siblings = GRAMMAR_SIBLING_MODULES[grammar] ?? [];
  let total = GRAMMAR_MODULE_GZIP_BYTES[grammar];
  for (const sibling of siblings) {
    total += GRAMMAR_MODULE_GZIP_BYTES[sibling];
  }

  return total;
}

const TSX_BYTES = GRAMMAR_MODULE_GZIP_BYTES[GrammarNames.TSX];
const JSON_BYTES = GRAMMAR_MODULE_GZIP_BYTES[GrammarNames.JSON];
const SCSS_BYTES = sumClosureBytes(GrammarNames.SCSS);
const ASTRO_BYTES = sumClosureBytes(GrammarNames.ASTRO);

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

  it("charges a module two grammars share once", () => {
    const plan = planGrammarBudget(
      [makeFile(GrammarNames.ASTRO, 90), makeFile(GrammarNames.TSX, 5)],
      ASTRO_BYTES,
    );

    expect(plan.admitted).toEqual([GrammarNames.ASTRO, GrammarNames.TSX]);
    expect(plan.spentBytes).toBe(ASTRO_BYTES);
  });

  it("charges a later grammar only for its unpaid modules", () => {
    const cssBytes = GRAMMAR_MODULE_GZIP_BYTES[GrammarNames.CSS];
    const plan = planGrammarBudget(
      [makeFile(GrammarNames.SCSS, 90), makeFile(GrammarNames.ASTRO, 5)],
      SCSS_BYTES + ASTRO_BYTES - cssBytes,
    );

    expect(plan.admitted).toEqual([GrammarNames.SCSS, GrammarNames.ASTRO]);
    expect(plan.spentBytes).toBe(SCSS_BYTES + ASTRO_BYTES - cssBytes);
  });

  it("leaves a skipped grammar's modules unpaid", () => {
    const plan = planGrammarBudget(
      [makeFile(GrammarNames.ASTRO, 90), makeFile(GrammarNames.TSX, 5)],
      TSX_BYTES,
    );

    expect(plan.admitted).toEqual([GrammarNames.TSX]);
    expect(plan.spentBytes).toBe(TSX_BYTES);
  });

  it("keeps Astro when TypeScript and SCSS outrank it", () => {
    const plan = planGrammarBudget(
      [
        makeFile(GrammarNames.TYPESCRIPT, 500),
        makeFile(GrammarNames.SCSS, 300),
        makeFile(GrammarNames.ASTRO, 200),
        makeFile(GrammarNames.JSON, 50),
      ],
      GRAMMAR_BUDGET_BYTES,
    );

    expect(plan.admitted).toEqual([
      GrammarNames.TYPESCRIPT,
      GrammarNames.SCSS,
      GrammarNames.ASTRO,
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
