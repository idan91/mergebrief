import type { Brief } from "brief-core/types";

/**
 * Minimal schema-valid Brief factory for eval-harness tests. Runs entirely
 * offline: the harness's run executor takes an injected generate boundary, so
 * suites never touch a live adapter.
 */
export function makeBrief(overrides: Partial<Brief> = {}): Brief {
  return {
    pr: {
      repo: "idan91/fixture",
      number: 1,
      title: "fixture PR",
      url: "https://github.com/idan91/fixture/pull/1",
      sha: "headsha",
      description: "",
    },
    index: 1,
    commitRange: { base: "basesha", head: "headsha", commitCount: 1 },
    generation: { provider: "fake", model: "fake-model", effort: "medium" },
    summary: "overview",
    changeGroups: [
      {
        id: "g1",
        title: "Group 1",
        summary: "does a thing",
        dominantCategory: "new-feature",
        secondaryCategories: [],
        uncertain: false,
        uncertainBetween: [],
      },
    ],
    chunks: [],
    concernView: [],
    ...overrides,
  };
}

/** N distinct groups g1..gN, for group-count properties. */
export function briefWithGroups(groupCount: number): Brief {
  return makeBrief({
    changeGroups: Array.from({ length: groupCount }, (_, i) => ({
      id: `g${i + 1}`,
      title: `Group ${i + 1}`,
      summary: "s",
      dominantCategory: "new-feature",
      secondaryCategories: [],
      uncertain: false,
      uncertainBetween: [],
    })),
  });
}
