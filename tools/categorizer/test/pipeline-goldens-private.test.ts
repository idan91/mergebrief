import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { describePipelineGoldens } from "./pipeline-goldens-suite";

const corpus = await describePipelineGoldens({
  casesDir: fileURLToPath(new URL("../eval/private-cases", import.meta.url)),
  pairsDir: fileURLToPath(
    new URL("../eval/private-pair-cases", import.meta.url),
  ),
  requiresEveryWarningFamily: false,
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
