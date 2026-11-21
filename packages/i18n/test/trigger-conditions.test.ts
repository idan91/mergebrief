import { describe, expect, it } from "vitest";
import {
  BotStates,
  ReviewBots,
  SizeBoundSides,
  SizeMeasures,
  TriggerConditionKinds,
  TriggerConditionSetters,
  UnmetConditionKinds,
  type BotState,
} from "types/trigger-conditions";
import {
  createI18n,
  describeUnmetCondition,
  isWaitingCondition,
  sortUnmetConditions,
  type UnmetConditionFormat,
} from "../src/index";

const { t } = createI18n();
const REPO = TriggerConditionSetters.REPO;

function formatQuoted(name: string): string {
  return `"${name}"`;
}

function formatQuotedList(names: readonly string[]): string {
  return names.map(formatQuoted).join(" + ");
}

function formatCheckCount(names: readonly string[]): string {
  return `${names.length} checks`;
}

const FORMAT: UnmetConditionFormat = {
  t,
  formatName: formatQuoted,
  formatNames: formatQuotedList,
  formatChecks: formatCheckCount,
};

describe("describeUnmetCondition", () => {
  it("words a flag kind from its catalog key", () => {
    const condition = { kind: TriggerConditionKinds.NEVER, setBy: REPO };

    expect(describeUnmetCondition(condition, FORMAT)).toEqual([
      "Generates only when someone presses Generate",
    ]);
  });

  it("words a size bound by its side", () => {
    const condition = {
      kind: TriggerConditionKinds.SIZE,
      setBy: REPO,
      measure: SizeMeasures.ADDITIONS,
      side: SizeBoundSides.MIN,
      limit: 10,
      actual: 3,
    };

    expect(describeUnmetCondition(condition, FORMAT)).toEqual([
      "3 added lines, under the 10 minimum",
    ]);
  });

  it("writes name lists and the base through the surface's formatters", () => {
    const condition = {
      kind: TriggerConditionKinds.BASE_BRANCHES,
      setBy: REPO,
      base: "dev",
      branches: ["main", "release"],
    };

    expect(describeUnmetCondition(condition, FORMAT)).toEqual([
      'Targets "dev", not one of "main" + "release"',
    ]);
  });

  it("words a base GitHub named none without naming one", () => {
    const condition = {
      kind: TriggerConditionKinds.BASE_BRANCHES,
      setBy: REPO,
      branches: ["main"],
    };

    expect(describeUnmetCondition(condition, FORMAT)).toEqual([
      'Needs "main" as the base branch, and GitHub named none',
    ]);
  });

  it("counts a bot's issues without reading its verdict", () => {
    const condition = {
      kind: TriggerConditionKinds.BOTS,
      setBy: REPO,
      bot: ReviewBots.CODERABBIT,
      state: BotStates.ISSUES,
      issues: 2,
    };

    expect(describeUnmetCondition(condition, FORMAT)).toEqual([
      "CodeRabbit found 2 issues",
    ]);
  });

  it("gives CI one reason per state with checks, through formatChecks", () => {
    const condition = {
      kind: TriggerConditionKinds.CI,
      setBy: REPO,
      failed: ["lint"],
      running: [],
      missing: ["build", "test"],
      permissionMissing: false,
    };

    expect(describeUnmetCondition(condition, FORMAT)).toEqual([
      "CI failed: 1 checks",
      "Waiting for CI: 2 checks have not reported on this push",
    ]);
  });

  it("gives CI one permission reason in place of its states", () => {
    const condition = {
      kind: TriggerConditionKinds.CI,
      setBy: REPO,
      failed: ["lint"],
      running: [],
      missing: [],
      permissionMissing: true,
    };

    expect(describeUnmetCondition(condition, FORMAT)).toEqual([
      "Can't check CI until this installation accepts MergeBrief's Checks and Commit statuses permissions",
    ]);
  });
});

function makeBot(state: BotState) {
  return { kind: TriggerConditionKinds.BOTS, state };
}

function makeCi(failed: readonly string[], permissionMissing = false) {
  return { kind: TriggerConditionKinds.CI, failed, permissionMissing };
}

const LABELS = { kind: TriggerConditionKinds.LABELS };

describe("isWaitingCondition", () => {
  it.each([BotStates.NOT_STARTED, BotStates.RUNNING])(
    "waits on a bot that is %s",
    (state) => {
      expect(isWaitingCondition(makeBot(state))).toBe(true);
    },
  );

  it.each([
    BotStates.NOT_APPROVED,
    BotStates.ISSUES,
    BotStates.NO_VERDICT,
    BotStates.PERMISSION_MISSING,
  ])("needs a change on a bot that is %s", (state) => {
    expect(isWaitingCondition(makeBot(state))).toBe(false);
  });

  it("waits on CI with nothing failed, and needs a change otherwise", () => {
    expect(isWaitingCondition(makeCi([]))).toBe(true);
    expect(isWaitingCondition(makeCi(["build"]))).toBe(false);
    expect(isWaitingCondition(makeCi([], true))).toBe(false);
  });

  it("never waits on a kind its state does not decide", () => {
    expect(isWaitingCondition(LABELS)).toBe(false);
  });

  it("waits on an any group when one member waits", () => {
    const waiting = {
      kind: UnmetConditionKinds.ANY,
      conditions: [LABELS, makeBot(BotStates.RUNNING)],
    };
    const blocked = { kind: UnmetConditionKinds.ANY, conditions: [LABELS] };

    expect(isWaitingCondition(waiting)).toBe(true);
    expect(isWaitingCondition(blocked)).toBe(false);
  });
});

describe("sortUnmetConditions", () => {
  it("puts waits first, then blockers, then any groups, each in order", () => {
    const group = { kind: UnmetConditionKinds.ANY, conditions: [LABELS] };
    const failedCi = makeCi(["build"]);
    const runningBot = makeBot(BotStates.RUNNING);
    const runningCi = makeCi([]);

    const sorted = sortUnmetConditions([
      group,
      failedCi,
      runningBot,
      LABELS,
      runningCi,
    ]);

    expect(sorted).toEqual([runningBot, runningCi, failedCi, LABELS, group]);
  });
});
