import { describe, expect, it } from "vitest";
import type {
  EffectiveTriggerConditions,
  TriggerConditionSetting,
} from "generators/trigger-conditions";
import {
  evaluateTriggerConditions,
  isVerdictOnPaths,
} from "../src/task/generate/logic/condition-check/evaluate";
import type { ConditionFacts } from "../src/task/generate/logic/condition-check/types";

const BASE_FACTS: ConditionFacts = {
  draft: false,
  title: "Add widgets",
  baseRef: "main",
  labels: [],
  pendingReviewRequests: 0,
  sizes: { "changed-lines": 120, additions: 100, deletions: 20 },
  changedPaths: ["src/widgets/index.ts"],
};

function makeFacts(overrides: Partial<ConditionFacts> = {}): ConditionFacts {
  return { ...BASE_FACTS, ...overrides };
}

function makeFactsWithoutBase(): ConditionFacts {
  const { baseRef: _absent, ...facts } = BASE_FACTS;
  return facts;
}

function makeEffective(
  setting: TriggerConditionSetting,
): EffectiveTriggerConditions {
  return { all: [{ setting, setBy: "repo" }], any: [] };
}

function evaluateOne(
  setting: TriggerConditionSetting,
  overrides: Partial<ConditionFacts> = {},
) {
  return evaluateTriggerConditions(
    makeEffective(setting),
    makeFacts(overrides),
  );
}

describe("evaluateTriggerConditions, size", () => {
  it.each([
    [99, false],
    [100, true],
    [500, true],
    [501, false],
  ])("checks changed lines %i against 100..500, met %s", (lines, met) => {
    const unmet = evaluateOne(
      { kind: "size", value: { "changed-lines": { min: 100, max: 500 } } },
      { sizes: { "changed-lines": lines, additions: 0, deletions: 0 } },
    );

    expect(unmet.length === 0).toBe(met);
  });

  it("names the missed max with the measure, limit and actual", () => {
    const unmet = evaluateOne(
      { kind: "size", value: { additions: { max: 50 } } },
      { sizes: { "changed-lines": 120, additions: 100, deletions: 20 } },
    );

    expect(unmet).toEqual([
      {
        kind: "size",
        setBy: "repo",
        measure: "additions",
        side: "max",
        limit: 50,
        actual: 100,
      },
    ]);
  });

  it("emits one item per missed bound across measures", () => {
    const unmet = evaluateOne(
      {
        kind: "size",
        value: {
          "changed-lines": { max: 10 },
          additions: { max: 500 },
          deletions: { min: 30 },
        },
      },
      { sizes: { "changed-lines": 120, additions: 100, deletions: 20 } },
    );

    expect(unmet).toEqual([
      {
        kind: "size",
        setBy: "repo",
        measure: "changed-lines",
        side: "max",
        limit: 10,
        actual: 120,
      },
      {
        kind: "size",
        setBy: "repo",
        measure: "deletions",
        side: "min",
        limit: 30,
        actual: 20,
      },
    ]);
  });
});

describe("evaluateTriggerConditions, labels", () => {
  it("is met when the pull request carries one of the labels", () => {
    const unmet = evaluateOne(
      { kind: "labels", value: ["needs-brief", "large"] },
      { labels: ["bug", "large"] },
    );

    expect(unmet).toEqual([]);
  });

  it("matches label names without regard to case", () => {
    const unmet = evaluateOne(
      { kind: "labels", value: ["Needs-Brief"] },
      { labels: ["needs-brief"] },
    );

    expect(unmet).toEqual([]);
  });

  it("names every configured label when none is carried", () => {
    const unmet = evaluateOne(
      { kind: "labels", value: ["needs-brief", "large"] },
      { labels: ["bug"] },
    );

    expect(unmet).toEqual([
      { kind: "labels", setBy: "repo", labels: ["needs-brief", "large"] },
    ]);
  });
});

describe("evaluateTriggerConditions, titleKeywords", () => {
  it.each([
    ["WIP: add widgets", "wip"],
    ["[Brief] add widgets", "brief"],
    ["Add widgets (ready for review)", "Ready for review"],
    ["chore: tidy", "chore:"],
    ["Fix the [skip-brief] path", "[skip-brief]"],
  ])("finds a keyword in %j", (title, keyword) => {
    const unmet = evaluateOne(
      { kind: "title-keywords", value: [keyword] },
      { title },
    );

    expect(unmet).toEqual([]);
  });

  it.each([
    ["Wipe the cache", "wip"],
    ["Add a prefix", "fix"],
    ["Debriefing notes", "brief"],
  ])("does not find a keyword inside a longer word in %j", (title, keyword) => {
    const unmet = evaluateOne(
      { kind: "title-keywords", value: [keyword] },
      { title },
    );

    expect(unmet).toEqual([
      { kind: "title-keywords", setBy: "repo", keywords: [keyword] },
    ]);
  });

  it("reads a keyword's regex characters literally", () => {
    const unmet = evaluateOne(
      { kind: "title-keywords", value: ["a.b"] },
      { title: "axb release" },
    );

    expect(unmet).toHaveLength(1);
  });
});

describe("evaluateTriggerConditions, baseBranches", () => {
  it("is met when the direct base is one of the branches", () => {
    const unmet = evaluateOne(
      { kind: "base-branches", value: ["main", "release"] },
      { baseRef: "release" },
    );

    expect(unmet).toEqual([]);
  });

  it("holds a stacked pull request into another branch", () => {
    const unmet = evaluateOne(
      { kind: "base-branches", value: ["main"] },
      { baseRef: "feature/parent" },
    );

    expect(unmet).toEqual([
      {
        kind: "base-branches",
        setBy: "repo",
        base: "feature/parent",
        branches: ["main"],
      },
    ]);
  });

  it("holds without a base when GitHub named none", () => {
    const unmet = evaluateTriggerConditions(
      makeEffective({ kind: "base-branches", value: ["main"] }),
      makeFactsWithoutBase(),
    );

    expect(unmet).toStrictEqual([
      { kind: "base-branches", setBy: "repo", branches: ["main"] },
    ]);
  });

  it("compares branch names with case, as git does", () => {
    const unmet = evaluateOne(
      { kind: "base-branches", value: ["Main"] },
      { baseRef: "main" },
    );

    expect(unmet).toHaveLength(1);
  });
});

describe("evaluateTriggerConditions, reviewRequested", () => {
  it.each([
    [0, false],
    [1, true],
    [3, true],
  ])("with %i pending requests is met %s", (pending, met) => {
    const unmet = evaluateOne(
      { kind: "review-requested", value: true },
      { pendingReviewRequests: pending },
    );

    expect(unmet.length === 0).toBe(met);
  });

  it("names the unmet request with its source", () => {
    const unmet = evaluateOne({ kind: "review-requested", value: true });

    expect(unmet).toEqual([{ kind: "review-requested", setBy: "repo" }]);
  });
});

describe("evaluateTriggerConditions, paths", () => {
  it("is met when a changed file matches one of the globs", () => {
    const unmet = evaluateOne(
      { kind: "paths", value: ["docs/**", "src/widgets/*.ts"] },
      { changedPaths: ["README.md", "src/widgets/index.ts"] },
    );

    expect(unmet).toEqual([]);
  });

  it("names every configured glob when no changed file matches", () => {
    const unmet = evaluateOne(
      { kind: "paths", value: ["src/payments/**", "*.sql"] },
      { changedPaths: ["src/widgets/index.ts", "db/001.sql"] },
    );

    expect(unmet).toEqual([
      { kind: "paths", setBy: "repo", paths: ["src/payments/**", "*.sql"] },
    ]);
  });

  it.each([
    ["src/**", "src/a/b/c.ts", true],
    ["src/**/*.ts", "src/c.ts", true],
    ["**/*.sql", "db/migrations/001.sql", true],
    ["**/*.sql", "001.sql", true],
    ["src/*", "src/a/b.ts", false],
    ["src/**/fixtures/**", "src/notfixtures/a.json", false],
    ["Src/**", "src/a.ts", false],
  ])("matches %s against %s: %s", (glob, path, met) => {
    const unmet = evaluateOne(
      { kind: "paths", value: [glob] },
      { changedPaths: [path] },
    );

    expect(unmet.length === 0).toBe(met);
  });

  it("holds a pull request that changes no file", () => {
    const unmet = evaluateOne(
      { kind: "paths", value: ["**"] },
      { changedPaths: [] },
    );

    expect(unmet).toHaveLength(1);
  });

  it("holds once the scan outruns its step budget", () => {
    const glob = `**/${"x".repeat(196)}*`;
    const misses = Array.from(
      { length: 2999 },
      (_, index) => `src/${String(index).padStart(195, "0")}`,
    );
    const lastMatches = `a/${"x".repeat(197)}`;

    const unmet = evaluateOne(
      { kind: "paths", value: [glob] },
      { changedPaths: [...misses, lastMatches] },
    );

    expect(unmet).toHaveLength(1);
  });

  it("skips paths outside a glob's literal prefix at no cost", () => {
    const misses = Array.from(
      { length: 2999 },
      (_, index) => `other/${String(index).padStart(195, "0")}`,
    );

    const unmet = evaluateOne(
      { kind: "paths", value: ["src/payments/handlers/refunds/stripe/**"] },
      {
        changedPaths: [
          ...misses,
          "src/payments/handlers/refunds/stripe/charge.ts",
        ],
      },
    );

    expect(unmet).toEqual([]);
  });

  it("skips paths outside a glob's literal suffix at no cost", () => {
    const misses = Array.from(
      { length: 2999 },
      (_, index) => `src/${String(index).padStart(195, "0")}`,
    );

    const unmet = evaluateOne(
      { kind: "paths", value: ["**/*.generated-migration-snapshot.sql"] },
      { changedPaths: [...misses, "db/001.generated-migration-snapshot.sql"] },
    );

    expect(unmet).toEqual([]);
  });

  it("tries the glob with the longest literal prefix first", () => {
    const misses = Array.from(
      { length: 2999 },
      (_, index) => `src/${String(index).padStart(195, "0")}`,
    );

    const unmet = evaluateOne(
      { kind: "paths", value: [`**/${"x".repeat(196)}*`, "src/payments/**"] },
      { changedPaths: [...misses, "src/payments/charge.ts"] },
    );

    expect(unmet).toEqual([]);
  });

  it("reads unread changed paths as met", () => {
    const unmet = evaluateTriggerConditions(
      makeEffective({ kind: "paths", value: ["src/payments/**"] }),
      { ...BASE_FACTS, changedPaths: undefined },
    );

    expect(unmet).toEqual([]);
  });
});

describe("isVerdictOnPaths", () => {
  const paths: TriggerConditionSetting = {
    kind: "paths",
    value: ["src/payments/**"],
  };
  const labels: TriggerConditionSetting = {
    kind: "labels",
    value: ["needs-brief"],
  };
  const unread: ConditionFacts = { ...BASE_FACTS, changedPaths: undefined };

  it("is false with no paths condition", () => {
    expect(isVerdictOnPaths(makeEffective(labels), unread)).toBe(false);
  });

  it("is true for a paths condition when the rest pass", () => {
    const effective: EffectiveTriggerConditions = {
      all: [
        { setting: paths, setBy: "repo" },
        { setting: labels, setBy: "repo" },
      ],
      any: [],
    };

    const verdictOnPaths = isVerdictOnPaths(effective, {
      ...unread,
      labels: ["needs-brief"],
    });

    expect(verdictOnPaths).toBe(true);
  });

  it("is false while another plain condition is unmet", () => {
    const effective: EffectiveTriggerConditions = {
      all: [
        { setting: paths, setBy: "repo" },
        { setting: labels, setBy: "repo" },
      ],
      any: [],
    };

    expect(isVerdictOnPaths(effective, unread)).toBe(false);
  });

  it("is false once another member of its any group is met", () => {
    const effective: EffectiveTriggerConditions = {
      all: [],
      any: [
        { setting: paths, setBy: "repo" },
        { setting: labels, setBy: "repo" },
      ],
    };

    const verdictOnPaths = isVerdictOnPaths(effective, {
      ...unread,
      labels: ["needs-brief"],
    });

    expect(verdictOnPaths).toBe(false);
  });

  it("is true while no other member of its any group is met", () => {
    const effective: EffectiveTriggerConditions = {
      all: [],
      any: [
        { setting: paths, setBy: "repo" },
        { setting: labels, setBy: "repo" },
      ],
    };

    expect(isVerdictOnPaths(effective, unread)).toBe(true);
  });
});

describe("evaluateTriggerConditions, any group", () => {
  it("passes when one member is met", () => {
    const effective: EffectiveTriggerConditions = {
      all: [],
      any: [
        { setting: { kind: "labels", value: ["large"] }, setBy: "repo" },
        { setting: { kind: "review-requested", value: true }, setBy: "repo" },
      ],
    };

    const unmet = evaluateTriggerConditions(
      effective,
      makeFacts({ pendingReviewRequests: 1 }),
    );

    expect(unmet).toEqual([]);
  });
});

describe("evaluateTriggerConditions, any group of paths and more", () => {
  const pathsOrLabels: EffectiveTriggerConditions = {
    all: [],
    any: [
      {
        setting: { kind: "paths", value: ["src/payments/**"] },
        setBy: "repo",
      },
      { setting: { kind: "labels", value: ["needs-brief"] }, setBy: "repo" },
    ],
  };

  it("passes on a matching path alone", () => {
    const unmet = evaluateTriggerConditions(
      pathsOrLabels,
      makeFacts({ changedPaths: ["src/payments/refund.ts"] }),
    );

    expect(unmet).toEqual([]);
  });

  it("passes on the label alone when no path matches", () => {
    const unmet = evaluateTriggerConditions(
      pathsOrLabels,
      makeFacts({ labels: ["needs-brief"] }),
    );

    expect(unmet).toEqual([]);
  });

  it("holds with every member's unmet item when none passes", () => {
    const unmet = evaluateTriggerConditions(pathsOrLabels, makeFacts());

    expect(unmet).toEqual([
      {
        kind: "any",
        conditions: [
          { kind: "paths", setBy: "repo", paths: ["src/payments/**"] },
          { kind: "labels", setBy: "repo", labels: ["needs-brief"] },
        ],
      },
    ]);
  });

  it("lists unmet plain conditions first and the unmet group last", () => {
    const effective: EffectiveTriggerConditions = {
      all: [
        {
          setting: { kind: "review-requested", value: true },
          setBy: "instance",
        },
      ],
      any: pathsOrLabels.any,
    };

    const unmet = evaluateTriggerConditions(effective, makeFacts());

    expect(unmet.map((item) => item.kind)).toEqual(["review-requested", "any"]);
  });

  it("still holds on an unmet plain condition when the group passes", () => {
    const effective: EffectiveTriggerConditions = {
      all: [
        { setting: { kind: "base-branches", value: ["main"] }, setBy: "repo" },
      ],
      any: pathsOrLabels.any,
    };

    const unmet = evaluateTriggerConditions(
      effective,
      makeFacts({ baseRef: "release", labels: ["needs-brief"] }),
    );

    expect(unmet.map((item) => item.kind)).toEqual(["base-branches"]);
  });
});
