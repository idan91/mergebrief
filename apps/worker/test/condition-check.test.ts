import { describe, expect, it } from "vitest";
import type {
  EffectiveTriggerConditions,
  TriggerConditionSetting,
} from "generators/trigger-conditions";
import { evaluateTriggerConditions } from "../src/task/generate/logic/condition-check/evaluate";
import type { ConditionFacts } from "../src/task/generate/logic/condition-check/types";

const BASE_FACTS: ConditionFacts = {
  draft: false,
  title: "Add widgets",
  baseRef: "main",
  labels: [],
  pendingReviewRequests: 0,
  sizes: { "changed-lines": 120, additions: 100, deletions: 20 },
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
