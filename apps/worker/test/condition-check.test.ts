import { describe, expect, it } from "vitest";
import type { CheckRun, CommitStatus, SubmittedReview } from "github";
import type { Mutable } from "types/utils";
import type {
  EffectiveTriggerConditions,
  TriggerConditionSetting,
} from "generators/trigger-conditions";
import {
  evaluateTriggerConditions,
  isVerdictOnPaths,
} from "../src/task/generate/logic/condition-check/evaluate";
import type {
  ConditionFacts,
  HeadReports,
} from "../src/task/generate/logic/condition-check/types";
import { createLogger, type Logger } from "logging";

const HEAD = "a".repeat(40);
/** A scan that spends the whole step budget runs past vitest's 5 s default under coverage. */
const BUDGET_SCAN_TIMEOUT_MS = 30_000;

const NO_REPORTS: HeadReports = {
  checkRuns: [],
  statuses: [],
  statusChecksForbidden: false,
  reviews: [],
  requiredChecks: [],
};

const BASE_FACTS: ConditionFacts = {
  draft: false,
  title: "Add widgets",
  headSha: HEAD,
  baseRef: "main",
  labels: [],
  pendingReviewRequests: 0,
  sizes: { "changed-lines": 120, additions: 100, deletions: 20 },
  changedFileCount: 1,
  changedPaths: ["src/widgets/index.ts"],
  reports: NO_REPORTS,
};

function stubLogger(lines: Record<string, unknown>[]): Logger {
  return createLogger({
    env: {},
    destination: {
      write: (line: string) => void lines.push(JSON.parse(line)),
    },
  });
}

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
    ["生成简报", "简报"],
    ["レビュー依頼: 機能追加", "レビュー"],
  ])("finds a keyword in a script without spaces in %j", (title, keyword) => {
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
    ["**/package.json", "package.json", true],
    ["**/Dockerfile", "Dockerfile", true],
    ["**/package.json", "apps/web/package.json", true],
    ["**/package.json", "apps/web/package.json.bak", false],
    ["**/Dockerfile", "docker/Dockerfile.dev", false],
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

  it(
    "holds once the scan outruns its step budget",
    () => {
      const glob = `**/${"x".repeat(196)}*`;
      const misses = Array.from(
        { length: 2999 },
        (_, index) => `src/${String(index).padStart(195, "0")}`,
      );
      const lastMatches = `a/${"x".repeat(197)}`;

      const lines: Record<string, unknown>[] = [];

      const unmet = evaluateTriggerConditions(
        makeEffective({ kind: "paths", value: [glob] }),
        makeFacts({ changedPaths: [...misses, lastMatches] }),
        stubLogger(lines),
      );

      expect(unmet).toHaveLength(1);
      expect(lines).toEqual([
        expect.objectContaining({ level: "warn", globs: 1, paths: 3000 }),
      ]);
    },
    BUDGET_SCAN_TIMEOUT_MS,
  );

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

  it(
    "matches a mass rename's last new path within the step budget",
    () => {
      const renamedTo = Array.from(
        { length: 2999 },
        (_, index) => `apps/${String(index).padStart(195, "0")}`,
      );
      const renamedFrom = Array.from(
        { length: 2999 },
        (_, index) => `libs/${String(index).padStart(195, "0")}`,
      );

      const unmet = evaluateOne(
        {
          kind: "paths",
          value: ["**/payments/**", "**/billing/**", "**/ledger/**"],
        },
        {
          changedFileCount: 3000,
          changedPaths: [...renamedTo, "services/ledger/post.ts"],
          previousPaths: renamedFrom,
        },
      );

      expect(unmet).toEqual([]);
    },
    BUDGET_SCAN_TIMEOUT_MS,
  );

  it("matches a rename by its old path once every new path misses", () => {
    const unmet = evaluateOne(
      { kind: "paths", value: ["src/payments/**"] },
      {
        changedPaths: ["archive/refund.ts"],
        previousPaths: ["src/payments/refund.ts"],
      },
    );

    expect(unmet).toEqual([]);
  });

  it("reads a PR past GitHub's file list as met without matching", () => {
    const unmet = evaluateOne(
      { kind: "paths", value: ["src/payments/**"] },
      { changedFileCount: 3001, changedPaths: ["docs/guide.md"] },
    );

    expect(unmet).toEqual([]);
  });

  it("still matches a PR at exactly GitHub's file list length", () => {
    const unmet = evaluateOne(
      { kind: "paths", value: ["src/payments/**"] },
      { changedFileCount: 3000, changedPaths: ["docs/guide.md"] },
    );

    expect(unmet).toHaveLength(1);
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

  it("is false while an any group without paths holds the head", () => {
    const effective: EffectiveTriggerConditions = {
      all: [{ setting: paths, setBy: "repo" }],
      any: [
        { setting: labels, setBy: "repo" },
        { setting: { kind: "title-keywords", value: ["wip"] }, setBy: "repo" },
      ],
    };

    expect(isVerdictOnPaths(effective, unread)).toBe(false);
  });

  it("is false while a failing ci member leaves its any group unmet", () => {
    const effective: EffectiveTriggerConditions = {
      all: [{ setting: paths, setBy: "repo" }],
      any: [
        { setting: labels, setBy: "repo" },
        {
          setting: { kind: "ci", value: { mode: "named", checks: ["build"] } },
          setBy: "repo",
        },
      ],
    };
    const failingBuild: HeadReports = {
      ...NO_REPORTS,
      checkRuns: [makeRun({ name: "build", conclusion: "failure" })],
    };

    const verdictOnPaths = isVerdictOnPaths(effective, {
      ...unread,
      reports: failingBuild,
    });

    expect(verdictOnPaths).toBe(false);
  });

  it("is true while a met ci member keeps its any group open", () => {
    const effective: EffectiveTriggerConditions = {
      all: [{ setting: paths, setBy: "repo" }],
      any: [
        { setting: labels, setBy: "repo" },
        {
          setting: { kind: "ci", value: { mode: "required" } },
          setBy: "repo",
        },
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

  it("passes on a PR past GitHub's file list with no path matching", () => {
    const unmet = evaluateTriggerConditions(
      pathsOrLabels,
      makeFacts({ changedFileCount: 3001 }),
    );

    expect(unmet).toEqual([]);
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

const APP_IDS = {
  unblocked: 166_219n,
  coderabbit: 347_564n,
  claude: 1_236_702n,
  greptile: 867_647n,
} as const;
const USER_IDS = {
  unblocked: 98_133_410n,
  coderabbit: 136_622_811n,
  claude: 209_825_114n,
  greptile: 165_735_046n,
  copilot: 175_728_472n,
} as const;
const ACTIONS_APP_ID = 15_368n;
const OLD_HEAD = "b".repeat(40);
const SEVERITY_TWO =
  'Two findings.\n<!-- bughunter-severity: {"nit":1,"normal":2,"pre_existing":0} -->';
const SEVERITY_ZERO =
  'Nits only.\n<!-- bughunter-severity: {"nit":3,"normal":0,"pre_existing":1} -->';

let nextRunId = 1n;

/** A completed run succeeds unless told otherwise; one still going has no conclusion. */
function makeRun(overrides: Partial<CheckRun> = {}): CheckRun {
  nextRunId += 1n;
  const run: Mutable<CheckRun> = {
    checkRunId: nextRunId,
    name: "build",
    appId: ACTIONS_APP_ID,
    completed: true,
    ...overrides,
  };
  if (run.completed && run.conclusion === undefined) {
    run.conclusion = "success";
  }
  return run;
}

function makeStatus(overrides: Partial<CommitStatus> = {}): CommitStatus {
  return { context: "build", state: "success", ...overrides };
}

function makeReview(overrides: Partial<SubmittedReview> = {}): SubmittedReview {
  return {
    reviewId: 1n,
    state: "COMMENTED",
    authorId: USER_IDS.copilot,
    commitId: HEAD,
    ...overrides,
  };
}

function makeReportFacts(
  reports: Partial<HeadReports>,
): Partial<ConditionFacts> {
  return { reports: { ...NO_REPORTS, ...reports } };
}

function evaluateBots(
  value: Partial<
    Record<keyof typeof USER_IDS, "finished" | "approved" | "clean">
  >,
  reports: Partial<HeadReports>,
) {
  return evaluateOne({ kind: "bots", value }, makeReportFacts(reports));
}

describe("evaluateTriggerConditions, bots finished", () => {
  it.each([
    ["coderabbit", "success"],
    ["claude", "neutral"],
    ["claude", "skipped"],
    ["greptile", "failure"],
    ["unblocked", "cancelled"],
  ] as const)("releases %s on its completed run, %s", (bot, conclusion) => {
    const run = makeRun({ name: "anything", appId: APP_IDS[bot], conclusion });

    expect(evaluateBots({ [bot]: "finished" }, { checkRuns: [run] })).toEqual(
      [],
    );
  });

  it.each(["success", "failure", "error"] as const)(
    "releases unblocked on its %s status",
    (state) => {
      const status = makeStatus({
        context: "Unblocked Review",
        state,
        creatorId: USER_IDS.unblocked,
      });

      expect(
        evaluateBots({ unblocked: "finished" }, { statuses: [status] }),
      ).toEqual([]);
    },
  );

  it("releases copilot on its commented review of the head", () => {
    const unmet = evaluateBots(
      { copilot: "finished" },
      { reviews: [makeReview()] },
    );

    expect(unmet).toEqual([]);
  });

  it("holds a bot with nothing on the head as not started", () => {
    expect(evaluateBots({ coderabbit: "finished" }, {})).toEqual([
      {
        kind: "bots",
        setBy: "repo",
        bot: "coderabbit",
        verdict: "finished",
        state: "not-started",
      },
    ]);
  });

  it("ignores a run under the bot's name from another app", () => {
    const spoof = makeRun({ name: "CodeRabbit", appId: ACTIONS_APP_ID });

    const unmet = evaluateBots(
      { coderabbit: "finished" },
      { checkRuns: [spoof] },
    );

    expect(unmet).toMatchObject([{ bot: "coderabbit", state: "not-started" }]);
  });

  it("ignores a status under the bot's context from another account", () => {
    const spoof = makeStatus({ context: "Unblocked Review", creatorId: 42n });

    const unmet = evaluateBots(
      { unblocked: "finished" },
      { statuses: [spoof] },
    );

    expect(unmet).toMatchObject([{ bot: "unblocked", state: "not-started" }]);
  });

  it("ignores a review the bot left on an earlier head", () => {
    const stale = makeReview({ commitId: OLD_HEAD });

    const unmet = evaluateBots({ copilot: "finished" }, { reviews: [stale] });

    expect(unmet).toMatchObject([{ bot: "copilot", state: "not-started" }]);
  });

  it("holds a bot whose run is in progress as running", () => {
    const run = makeRun({ appId: APP_IDS.greptile, completed: false });

    const unmet = evaluateBots({ greptile: "finished" }, { checkRuns: [run] });

    expect(unmet).toMatchObject([{ bot: "greptile", state: "running" }]);
  });

  it("holds a bot whose status is pending as running", () => {
    const status = makeStatus({
      state: "pending",
      creatorId: USER_IDS.unblocked,
    });

    const unmet = evaluateBots(
      { unblocked: "finished" },
      { statuses: [status] },
    );

    expect(unmet).toMatchObject([{ bot: "unblocked", state: "running" }]);
  });

  it("releases a bot with a completed run beside a newer pending one", () => {
    const runs = [
      makeRun({ appId: APP_IDS.coderabbit }),
      makeRun({ appId: APP_IDS.coderabbit, completed: false }),
    ];

    expect(
      evaluateBots({ coderabbit: "finished" }, { checkRuns: runs }),
    ).toEqual([]);
  });

  it.each(["unblocked", "coderabbit", "claude", "greptile"] as const)(
    "holds %s as permission missing when the reads are refused",
    (bot) => {
      const unmet = evaluateBots(
        { [bot]: "finished" },
        { statusChecksForbidden: true },
      );

      expect(unmet).toMatchObject([{ bot, state: "permission-missing" }]);
    },
  );

  it("checks copilot normally when the status reads are refused", () => {
    const unmet = evaluateBots(
      { copilot: "finished" },
      { statusChecksForbidden: true },
    );

    expect(unmet).toMatchObject([{ bot: "copilot", state: "not-started" }]);
  });

  it("emits one item per unmet bot in the order the setting lists", () => {
    const unmet = evaluateBots(
      { greptile: "finished", copilot: "finished", coderabbit: "finished" },
      { reviews: [makeReview()] },
    );

    expect(unmet.map((item) => "bot" in item && item.bot)).toEqual([
      "greptile",
      "coderabbit",
    ]);
  });
});

describe("evaluateTriggerConditions, bots approved", () => {
  function makeCodeRabbitReview(
    overrides: Partial<SubmittedReview>,
  ): SubmittedReview {
    return makeReview({ authorId: USER_IDS.coderabbit, ...overrides });
  }

  it("passes when the bot's latest review on the head approves", () => {
    const reviews = [
      makeCodeRabbitReview({ reviewId: 1n, state: "CHANGES_REQUESTED" }),
      makeCodeRabbitReview({ reviewId: 2n, state: "APPROVED" }),
    ];

    expect(evaluateBots({ coderabbit: "approved" }, { reviews })).toEqual([]);
  });

  it("keeps an approval a later comment follows", () => {
    const reviews = [
      makeCodeRabbitReview({ reviewId: 1n, state: "APPROVED" }),
      makeCodeRabbitReview({ reviewId: 2n, state: "COMMENTED" }),
    ];

    expect(evaluateBots({ coderabbit: "approved" }, { reviews })).toEqual([]);
  });

  it("holds when a later review replaced the approval", () => {
    const reviews = [
      makeCodeRabbitReview({ reviewId: 1n, state: "APPROVED" }),
      makeCodeRabbitReview({ reviewId: 2n, state: "CHANGES_REQUESTED" }),
      makeCodeRabbitReview({ reviewId: 3n, state: "COMMENTED" }),
    ];

    const unmet = evaluateBots({ coderabbit: "approved" }, { reviews });

    expect(unmet).toEqual([
      {
        kind: "bots",
        setBy: "repo",
        bot: "coderabbit",
        verdict: "approved",
        state: "not-approved",
      },
    ]);
  });

  it("holds when the bot's approval was dismissed", () => {
    const reviews = [makeCodeRabbitReview({ state: "DISMISSED" })];

    const unmet = evaluateBots({ coderabbit: "approved" }, { reviews });

    expect(unmet).toMatchObject([{ state: "not-approved" }]);
  });

  it("never revives an approval a later dismissed review followed", () => {
    const reviews = [
      makeCodeRabbitReview({ reviewId: 1n, state: "APPROVED" }),
      makeCodeRabbitReview({ reviewId: 2n, state: "DISMISSED" }),
      makeCodeRabbitReview({ reviewId: 3n, state: "COMMENTED" }),
    ];

    const unmet = evaluateBots({ coderabbit: "approved" }, { reviews });

    expect(unmet).toMatchObject([{ state: "not-approved" }]);
  });

  it("holds a bot that finished its run without approving", () => {
    const run = makeRun({ appId: APP_IDS.coderabbit });

    const unmet = evaluateBots(
      { coderabbit: "approved" },
      { checkRuns: [run] },
    );

    expect(unmet).toMatchObject([{ bot: "coderabbit", state: "not-approved" }]);
  });

  it("ignores an approval of an earlier head", () => {
    const run = makeRun({ appId: APP_IDS.unblocked });
    const stale = makeReview({
      state: "APPROVED",
      authorId: USER_IDS.unblocked,
      commitId: OLD_HEAD,
    });

    const unmet = evaluateBots(
      { unblocked: "approved" },
      { checkRuns: [run], reviews: [stale] },
    );

    expect(unmet).toMatchObject([{ state: "not-approved" }]);
  });

  it("holds an unfinished bot by its progress, not its approval", () => {
    expect(evaluateBots({ greptile: "approved" }, {})).toMatchObject([
      { state: "not-started" },
    ]);
  });
});

function makeClaudeRun(overrides: Partial<CheckRun> = {}): CheckRun {
  return makeRun({
    name: "Claude Code Review",
    appId: APP_IDS.claude,
    conclusion: "neutral",
    ...overrides,
  });
}

describe("evaluateTriggerConditions, bots clean", () => {
  it("passes on Claude's no-issues title", () => {
    const run = makeClaudeRun({ title: "Code review found no issues" });

    expect(evaluateBots({ claude: "clean" }, { checkRuns: [run] })).toEqual([]);
  });

  it("passes when the severity line counts no normal findings", () => {
    const run = makeClaudeRun({
      title: "Code review found 3 nits",
      text: SEVERITY_ZERO,
    });

    expect(evaluateBots({ claude: "clean" }, { checkRuns: [run] })).toEqual([]);
  });

  it("holds with the normal finding count from the severity line", () => {
    const run = makeClaudeRun({
      title: "Code review found 2 issues",
      text: SEVERITY_TWO,
    });

    const unmet = evaluateBots({ claude: "clean" }, { checkRuns: [run] });

    expect(unmet).toEqual([
      {
        kind: "bots",
        setBy: "repo",
        bot: "claude",
        verdict: "clean",
        state: "issues",
        issues: 2,
      },
    ]);
  });

  it.each([
    [
      "a missing severity line",
      makeClaudeRun({ title: "Code review not repeated" }),
    ],
    ["a skipped run", makeClaudeRun({ conclusion: "skipped" })],
    [
      "an unreadable severity line",
      makeClaudeRun({ text: "<!-- bughunter-severity: {normal: 0} -->" }),
    ],
    [
      "a severity line above the last line",
      makeClaudeRun({ text: `${SEVERITY_ZERO}\nMore text after it.` }),
    ],
  ])("holds as no verdict on %s", (_, run) => {
    const unmet = evaluateBots({ claude: "clean" }, { checkRuns: [run] });

    expect(unmet).toMatchObject([{ state: "no-verdict" }]);
  });

  it("reads the latest completed run, not an earlier clean one", () => {
    const runs = [
      makeClaudeRun({ title: "Code review found no issues" }),
      makeClaudeRun({ text: SEVERITY_TWO }),
    ];

    const unmet = evaluateBots({ claude: "clean" }, { checkRuns: runs });

    expect(unmet).toMatchObject([{ state: "issues", issues: 2 }]);
  });

  it("holds as permission missing when only its review shows", () => {
    const review = makeReview({ authorId: USER_IDS.claude });

    const unmet = evaluateBots(
      { claude: "clean" },
      { reviews: [review], statusChecksForbidden: true },
    );

    expect(unmet).toMatchObject([{ state: "permission-missing" }]);
  });

  it("holds as running while a rerun follows a clean run", () => {
    const runs = [
      makeClaudeRun({ title: "Code review found no issues" }),
      makeClaudeRun({ completed: false }),
    ];

    const unmet = evaluateBots({ claude: "clean" }, { checkRuns: runs });

    expect(unmet).toMatchObject([{ state: "running" }]);
  });

  it("holds as running while a rerun follows a run with issues", () => {
    const runs = [
      makeClaudeRun({ text: SEVERITY_TWO }),
      makeClaudeRun({ completed: false }),
    ];

    const unmet = evaluateBots({ claude: "clean" }, { checkRuns: runs });

    expect(unmet).toEqual([
      {
        kind: "bots",
        setBy: "repo",
        bot: "claude",
        verdict: "clean",
        state: "running",
      },
    ]);
  });

  it("holds as running while Claude's only run is in progress", () => {
    const run = makeClaudeRun({ completed: false });

    const unmet = evaluateBots({ claude: "clean" }, { checkRuns: [run] });

    expect(unmet).toMatchObject([{ state: "running" }]);
  });
});

function evaluateCi(
  value: { mode: "required" } | { mode: "named"; checks: string[] },
  reports: Partial<HeadReports>,
) {
  return evaluateOne({ kind: "ci", value }, makeReportFacts(reports));
}

const REQUIRED = { mode: "required" } as const;

describe("evaluateTriggerConditions, ci", () => {
  it("passes an empty required set", () => {
    expect(evaluateCi(REQUIRED, { requiredChecks: [] })).toEqual([]);
  });

  it("passes when every required check's latest run succeeded", () => {
    const runs = [makeRun({ name: "build" }), makeRun({ name: "lint" })];

    const unmet = evaluateCi(REQUIRED, {
      requiredChecks: ["build", "lint"],
      checkRuns: runs,
    });

    expect(unmet).toEqual([]);
  });

  it.each(["neutral", "skipped"])("passes a %s conclusion", (conclusion) => {
    const unmet = evaluateCi(REQUIRED, {
      requiredChecks: ["build"],
      checkRuns: [makeRun({ conclusion })],
    });

    expect(unmet).toEqual([]);
  });

  it("passes a failed run a later rerun succeeded", () => {
    const runs = [makeRun({ conclusion: "failure" }), makeRun()];

    const unmet = evaluateCi(REQUIRED, {
      requiredChecks: ["build"],
      checkRuns: runs,
    });

    expect(unmet).toEqual([]);
  });

  it("fails a passed run a later rerun failed", () => {
    const runs = [makeRun(), makeRun({ conclusion: "timed_out" })];

    const unmet = evaluateCi(REQUIRED, {
      requiredChecks: ["build"],
      checkRuns: runs,
    });

    expect(unmet).toMatchObject([{ failed: ["build"] }]);
  });

  it("lists failed, running and missing checks apart", () => {
    const runs = [
      makeRun({ name: "build", conclusion: "cancelled" }),
      makeRun({ name: "lint", completed: false }),
      makeRun({ name: "test" }),
    ];

    const unmet = evaluateCi(REQUIRED, {
      requiredChecks: ["build", "lint", "test", "e2e"],
      checkRuns: runs,
    });

    expect(unmet).toEqual([
      {
        kind: "ci",
        setBy: "repo",
        failed: ["build"],
        running: ["lint"],
        missing: ["e2e"],
        permissionMissing: false,
      },
    ]);
  });

  it("reads a status by its latest state, newest first", () => {
    const statuses = [
      makeStatus({ context: "deploy", state: "pending" }),
      makeStatus({ context: "deploy", state: "failure" }),
      makeStatus({ context: "docs", state: "error" }),
    ];

    const unmet = evaluateCi(
      { mode: "named", checks: ["deploy", "docs"] },
      { statuses },
    );

    expect(unmet).toMatchObject([{ failed: ["docs"], running: ["deploy"] }]);
  });

  it("matches a named check by run name or status context", () => {
    const unmet = evaluateCi(
      { mode: "named", checks: ["build", "deploy"] },
      {
        checkRuns: [makeRun({ name: "build" })],
        statuses: [makeStatus({ context: "deploy" })],
      },
    );

    expect(unmet).toEqual([]);
  });

  it("fails a name whose run passed but whose status failed", () => {
    const unmet = evaluateCi(
      { mode: "named", checks: ["build"] },
      {
        checkRuns: [makeRun()],
        statuses: [makeStatus({ state: "failure" })],
      },
    );

    expect(unmet).toMatchObject([{ failed: ["build"] }]);
  });

  it("names the missing permission when a read was refused", () => {
    const unmet = evaluateCi(REQUIRED, {
      requiredChecks: ["build"],
      statusChecksForbidden: true,
    });

    expect(unmet).toEqual([
      {
        kind: "ci",
        setBy: "repo",
        failed: [],
        running: [],
        missing: ["build"],
        permissionMissing: true,
      },
    ]);
  });

  it("passes on the readable source when the other read was refused", () => {
    const unmet = evaluateCi(
      { mode: "named", checks: ["deploy"] },
      {
        statuses: [makeStatus({ context: "deploy" })],
        statusChecksForbidden: true,
      },
    );

    expect(unmet).toEqual([]);
  });
});
