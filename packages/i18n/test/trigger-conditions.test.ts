import { describe, expect, it } from "vitest";
import {
  BotStates,
  ReviewBots,
  SizeBoundSides,
  SizeMeasures,
  TriggerConditionKinds,
  TriggerConditionSetters,
} from "types/trigger-conditions";
import {
  createI18n,
  describeUnmetCondition,
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
