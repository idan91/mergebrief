import type { Result } from "types/utils";
import { describe, expect, it } from "vitest";

import type { ConfigError } from "../src/contract/errors";

import {
  parseInstanceTriggerConditions,
  parseRepoTriggerConditions,
  resolveEffectiveTriggerConditions,
  type TriggerConditionsBlock,
} from "../src/config/trigger-conditions";

function parseRepo(block: unknown) {
  const parsed = parseRepoTriggerConditions(block);
  if (!parsed.ok) {
    throw new Error(parsed.error.issues.join("; "));
  }
  return parsed.value;
}

function parseInstance(block: unknown) {
  const parsed = parseInstanceTriggerConditions(block);
  if (!parsed.ok) {
    throw new Error(parsed.error.issues.join("; "));
  }
  return parsed.value;
}

function issuesOf(
  result: Result<TriggerConditionsBlock, ConfigError>,
): readonly string[] {
  return result.ok ? [] : result.error.issues;
}

describe("parsing a triggerConditions block", () => {
  it("reads every kind in its YAML shape", () => {
    const block = parseRepo({
      readyForReview: "on",
      size: { changedLines: { max: 800 } },
      bots: { unblocked: "finished", claude: "clean" },
      reviewRequested: true,
      ci: "required",
      paths: ["src/payments/**"],
      labels: ["needs-brief"],
      titleKeywords: ["[brief]"],
      baseBranches: ["main"],
    });

    expect(block.off).toBe(false);
    const kinds = block.off ? [] : block.all.map((setting) => setting.kind);
    expect(kinds).toEqual([
      "ready-for-review",
      "size",
      "bots",
      "review-requested",
      "ci",
      "paths",
      "labels",
      "title-keywords",
      "base-branches",
    ]);
  });

  it("reads named CI checks", () => {
    const block = parseRepo({ ci: { checks: ["build", "test"] } });
    expect(block.off ? undefined : block.all[0]).toEqual({
      kind: "ci",
      value: { mode: "named", checks: ["build", "test"] },
    });
  });

  it("reads the whole block switched off", () => {
    expect(parseRepo("off")).toEqual({ off: true });
    expect(parseRepo(false)).toEqual({ off: true });
  });

  it("records a kind switched off as dropped", () => {
    const block = parseRepo({ size: "off", labels: ["a"] });
    expect(block.off ? undefined : block.dropped).toEqual(["size"]);
  });

  it("refuses an empty block", () => {
    expect(issuesOf(parseRepoTriggerConditions({}))).not.toEqual([]);
  });

  it("refuses approved and clean where the bot never gives them", () => {
    expect(
      issuesOf(parseRepoTriggerConditions({ bots: { claude: "approved" } })),
    ).not.toEqual([]);
    expect(
      issuesOf(parseRepoTriggerConditions({ bots: { greptile: "clean" } })),
    ).not.toEqual([]);
  });

  it("refuses a bot outside the supported list without echoing its name", () => {
    const issues = issuesOf(
      parseRepoTriggerConditions({ bots: { "ghp_secret-bot": "finished" } }),
    );
    expect(issues).not.toEqual([]);
    expect(issues.join(" ")).not.toContain("ghp_secret");
  });

  it("refuses size bounds where min exceeds max or none is set", () => {
    expect(
      issuesOf(
        parseRepoTriggerConditions({ size: { additions: { min: 9, max: 3 } } }),
      ),
    ).not.toEqual([]);
    expect(
      issuesOf(parseRepoTriggerConditions({ size: { additions: {} } })),
    ).not.toEqual([]);
  });

  it("refuses paths in the instance file", () => {
    expect(
      issuesOf(parseInstanceTriggerConditions({ paths: ["src/**"] })),
    ).not.toEqual([]);
  });

  it("reads an any group of at least two kinds", () => {
    const block = parseRepo({
      any: {
        bots: { coderabbit: "approved" },
        size: { changedLines: { max: 500 } },
      },
    });
    expect(block.off ? [] : block.any.map((setting) => setting.kind)).toEqual([
      "bots",
      "size",
    ]);
  });

  it("refuses a lone-kind any group, never inside it, or a kind set twice", () => {
    expect(
      issuesOf(parseRepoTriggerConditions({ any: { labels: ["a"] } })),
    ).not.toEqual([]);
    expect(
      issuesOf(
        parseRepoTriggerConditions({ any: { never: true, labels: ["a"] } }),
      ),
    ).not.toEqual([]);
    expect(
      issuesOf(
        parseRepoTriggerConditions({
          labels: ["b"],
          any: { labels: ["a"], baseBranches: ["main"] },
        }),
      ),
    ).not.toEqual([]);
  });

  it("refuses never beside other kinds", () => {
    expect(
      issuesOf(parseRepoTriggerConditions({ never: true, labels: ["a"] })),
    ).not.toEqual([]);
  });
});

describe("merging the instance and repo blocks", () => {
  const instance = parseInstance({
    size: { changedLines: { min: 1000 } },
    labels: ["brief-me"],
  });

  it("inherits the instance's kinds when the repo names none", () => {
    const effective = resolveEffectiveTriggerConditions(instance, undefined);
    expect(
      effective.all.map((item) => [item.setting.kind, item.source]),
    ).toEqual([
      ["size", "instance"],
      ["labels", "instance"],
    ]);
  });

  it("lets the repo's kind replace the instance's whole and add its own", () => {
    const repo = parseRepo({
      labels: ["other"],
      bots: { unblocked: "finished" },
    });
    const effective = resolveEffectiveTriggerConditions(instance, repo);
    expect(
      effective.all.map((item) => [
        item.setting.kind,
        item.source,
        item.setting.value,
      ]),
    ).toEqual([
      ["size", "instance", { changedLines: { min: 1000 } }],
      ["labels", "repo", ["other"]],
      ["bots", "repo", { unblocked: "finished" }],
    ]);
  });

  it("drops a kind the repo switches off", () => {
    const effective = resolveEffectiveTriggerConditions(
      instance,
      parseRepo({ size: "off" }),
    );
    expect(effective.all.map((item) => item.setting.kind)).toEqual(["labels"]);
  });

  it("drops every inherited kind when the repo switches the block off", () => {
    const effective = resolveEffectiveTriggerConditions(
      instance,
      parseRepo("off"),
    );
    expect(effective).toEqual({ all: [], any: [] });
  });

  it("moves an inherited kind into the repo's any group with its new value", () => {
    const repo = parseRepo({
      any: { labels: ["x"], baseBranches: ["main"] },
    });
    const effective = resolveEffectiveTriggerConditions(instance, repo);
    expect(effective.all.map((item) => item.setting.kind)).toEqual(["size"]);
    expect(
      effective.any.map((item) => [item.setting.kind, item.source]),
    ).toEqual([
      ["labels", "repo"],
      ["base-branches", "repo"],
    ]);
  });

  it("folds an any group left with one member into the plain conditions", () => {
    const withGroup = parseInstance({
      any: { labels: ["a"], baseBranches: ["main"] },
    });
    const effective = resolveEffectiveTriggerConditions(
      withGroup,
      parseRepo({ labels: "off" }),
    );
    expect(effective.any).toEqual([]);
    expect(effective.all.map((item) => item.setting.kind)).toEqual([
      "base-branches",
    ]);
  });
});
