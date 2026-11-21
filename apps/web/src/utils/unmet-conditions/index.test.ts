import { describe, expect, it } from "vitest";

import { appI18n } from "../../i18n/I18nProvider";
import { makeAnyGroup, UnmetFixtures } from "@web/test/unmet-conditions";
import { describeUnmetReasons, splitUnmetConditions } from ".";

const t = appI18n.t;
const {
  BOT_NOT_APPROVED,
  BOT_RUNNING,
  CI_FAILED,
  CI_RUNNING,
  LABELS,
  READY_FOR_REVIEW,
  SIZE_OVER,
} = UnmetFixtures;

describe("splitUnmetConditions", () => {
  it("puts a running bot and running CI under waits", () => {
    const split = splitUnmetConditions([READY_FOR_REVIEW, CI_RUNNING]);

    expect(split.waits).toEqual([CI_RUNNING]);
    expect(split.needs).toEqual([READY_FOR_REVIEW]);
  });

  it("decides by state, so failed CI needs a change", () => {
    const split = splitUnmetConditions([CI_FAILED, BOT_RUNNING]);

    expect(split.waits).toEqual([BOT_RUNNING]);
    expect(split.needs).toEqual([CI_FAILED]);
  });

  it("waits on an any group when one member waits", () => {
    const group = makeAnyGroup(LABELS, CI_RUNNING);
    const split = splitUnmetConditions([group, READY_FOR_REVIEW]);

    expect(split.waits).toEqual([group]);
    expect(split.needs).toEqual([READY_FOR_REVIEW]);
  });

  it("orders each side as the Entry does, any groups last", () => {
    const group = makeAnyGroup(BOT_NOT_APPROVED, SIZE_OVER);
    const split = splitUnmetConditions([group, LABELS, READY_FOR_REVIEW]);

    expect(split.needs).toEqual([LABELS, READY_FOR_REVIEW, group]);
  });
});

describe("describeUnmetReasons", () => {
  it("words a plain kind as the Entry does", () => {
    expect(describeUnmetReasons(t, READY_FOR_REVIEW)).toEqual([
      "Needs this pull request marked ready for review",
    ]);
  });

  it("names the bot by its product name", () => {
    expect(describeUnmetReasons(t, BOT_RUNNING)).toEqual([
      "Waiting for CodeRabbit to finish",
    ]);
  });

  it("counts a bot's open issues", () => {
    const bot = { ...BOT_NOT_APPROVED, state: "issues", issues: 1 } as const;

    expect(describeUnmetReasons(t, bot)).toEqual(["CodeRabbit found 1 issue"]);
  });

  it("gives CI one line per state and names every check", () => {
    const ci = {
      ...CI_FAILED,
      failed: ["a", "b", "c", "d"],
      missing: ["deploy"],
    };

    expect(describeUnmetReasons(t, ci)).toEqual([
      "CI failed: a, b, c, d",
      "Waiting for CI: e2e still running",
      "Waiting for CI: deploy has not reported on this push",
    ]);
  });

  it("adds the permission line when CI cannot be read", () => {
    const ci = { ...CI_FAILED, permissionMissing: true };

    expect(describeUnmetReasons(t, ci)).toEqual([
      "CI failed: test",
      "Waiting for CI: e2e still running",
      "Can't check CI until this installation accepts MergeBrief's Checks and Commit statuses permissions",
    ]);
  });

  it("words a size miss with its numbers", () => {
    expect(describeUnmetReasons(t, SIZE_OVER)).toEqual([
      "1284 changed lines, over the 800 maximum",
    ]);
  });

  it("joins the configured names on a list kind", () => {
    const labels = { ...LABELS, labels: ["brief", "ready"] };

    expect(describeUnmetReasons(t, labels)).toEqual([
      "Needs one of the labels brief, ready",
    ]);
  });
});
