import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readPairSpanShapes } from "./hand-derived-span";
import { describePipelineGoldens } from "./pipeline-goldens-suite";

const PRIVATE_PAIR_CASES_DIR = fileURLToPath(
  new URL("../eval/private-pair-cases", import.meta.url),
);

const corpus = await describePipelineGoldens({
  casesDir: fileURLToPath(new URL("../eval/private-cases", import.meta.url)),
  pairsDir: PRIVATE_PAIR_CASES_DIR,
  requiresEveryWarningFamily: false,
  // 3,021 files and 1,248 hunks: its goldens run past the suite's limits and
  // would write a snapshot of about 195,000 lines.
  skippedPairCaseIds: ["pair-real-node-65881"],
});

describe("the private case set", () => {
  it("holds the cases the public snapshot leaves out", () => {
    expect(corpus.singleCases.map((found) => found.id)).toEqual([
      "delta-read-api-contract",
      "summary-media-code-review-1141",
      "summary-media-grafana-107803",
      "summary-media-home-assistant-55394",
      "summary-media-supabase-19466",
    ]);
    expect(corpus.pairCases.map((found) => found.id)).toEqual([
      "pair-real-brief143-docs",
    ]);
  });
});

describe("the private hand-derived pair span", () => {
  it("holds on pair-real-brief143-docs", async () => {
    const shapes = await readPairSpanShapes(
      PRIVATE_PAIR_CASES_DIR,
      "pair-real-brief143-docs",
    );

    for (const shape of shapes) {
      expect(shape).toEqual({
        files: ["docs/plans/brief-143-stability-implementation.md"],
        headers: ["@@ -0,0 +1,167 @@"],
      });
    }
  });
});
