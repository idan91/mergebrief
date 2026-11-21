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

function listIssues(
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

  it("keys a size setting by its kebab-case measures", () => {
    const block = parseRepo({
      size: { changedLines: { max: 800 }, additions: { min: 1 } },
    });
    expect(block.off ? undefined : block.all[0]).toEqual({
      kind: "size",
      value: { "changed-lines": { max: 800 }, additions: { min: 1 } },
    });
  });

  it("refuses a size measure written in its stored kebab-case form", () => {
    const parsed = parseRepoTriggerConditions({
      size: { "changed-lines": { max: 800 } },
    });
    expect(listIssues(parsed)).not.toEqual([]);
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
    const issues = listIssues(parseRepoTriggerConditions({}));
    expect(issues).not.toEqual([]);
  });

  it("reports only the parse error when the lone condition fails", () => {
    const issues = listIssues(
      parseRepoTriggerConditions({ bots: { claude: "approved" } }),
    );
    expect(issues).toHaveLength(1);
    expect(issues.join(" ")).not.toContain("name at least one");
  });

  it("refuses approved and clean where the bot never gives them", () => {
    const blocks = [
      { bots: { claude: "approved" } },
      { bots: { greptile: "clean" } },
      { bots: { copilot: "approved" } },
    ];
    for (const block of blocks) {
      const issues = listIssues(parseRepoTriggerConditions(block));
      expect(issues).not.toEqual([]);
    }
  });

  it("refuses a bot outside the supported list without echoing its name", () => {
    const parsed = parseRepoTriggerConditions({
      bots: { "ghp_secret-bot": "finished" },
    });
    const issues = listIssues(parsed);
    expect(issues).not.toEqual([]);
    expect(issues.join(" ")).not.toContain("ghp_secret");
  });

  it("refuses size bounds where min exceeds max or none is set", () => {
    const blocks = [
      { size: { additions: { min: 9, max: 3 } } },
      { size: { additions: {} } },
    ];
    for (const block of blocks) {
      const issues = listIssues(parseRepoTriggerConditions(block));
      expect(issues).not.toEqual([]);
    }
  });

  it("refuses paths in the instance file", () => {
    const parsed = parseInstanceTriggerConditions({ paths: ["src/**"] });
    expect(listIssues(parsed)).not.toEqual([]);
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
    const blocks = [
      { any: { labels: ["a"] } },
      { any: { never: true, labels: ["a"] } },
      { labels: ["b"], any: { labels: ["a"], baseBranches: ["main"] } },
    ];
    for (const block of blocks) {
      const issues = listIssues(parseRepoTriggerConditions(block));
      expect(issues).not.toEqual([]);
    }
  });

  it("refuses never beside other kinds", () => {
    const parsed = parseRepoTriggerConditions({ never: true, labels: ["a"] });
    expect(listIssues(parsed)).not.toEqual([]);
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
      effective.all.map((item) => [item.setting.kind, item.setBy]),
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
        item.setBy,
        item.setting.value,
      ]),
    ).toEqual([
      ["size", "instance", { "changed-lines": { min: 1000 } }],
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
      effective.any.map((item) => [item.setting.kind, item.setBy]),
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
