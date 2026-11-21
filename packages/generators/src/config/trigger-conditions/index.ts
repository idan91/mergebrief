import type { z } from "zod/v4";
import {
  TriggerConditionKinds,
  TriggerConditionSetters,
  type Result,
  type TriggerConditionKind,
  type TriggerConditionSetter,
} from "types";

import { renderKey, renderPathSegment } from "../render-key";
import { ANY_KEY, CONFIG_KEYS, SETTING_SCHEMAS, offSchema } from "./schemas";
import type {
  EffectiveCondition,
  EffectiveTriggerConditions,
  TriggerConditionSetting,
  TriggerConditionsBlock,
  TriggerConditionsIssue,
  TriggerConditionsPathSegment,
} from "./types";

const BLOCK = "triggerConditions";
const MIN_ANY_KINDS = 2;

function isConfigKey(key: string): key is keyof typeof CONFIG_KEYS {
  return Object.hasOwn(CONFIG_KEYS, key);
}

function isPlainMap(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function makeIssue(
  path: readonly TriggerConditionsPathSegment[],
  text: string,
  detailPath: readonly string[] = [],
): TriggerConditionsIssue {
  const location = [BLOCK, ...path, ...detailPath].join(".");
  return { path, message: `${location}: ${text}` };
}

function describeIssue(
  path: readonly TriggerConditionsPathSegment[],
  issue: z.core.$ZodIssue,
): TriggerConditionsIssue {
  const text =
    issue.code === "unrecognized_keys" ? "unrecognized key" : issue.message;
  return makeIssue(path, text, issue.path.map(renderPathSegment));
}

function parseSetting(
  kind: TriggerConditionKind,
  raw: unknown,
  path: readonly TriggerConditionsPathSegment[],
  issues: TriggerConditionsIssue[],
): TriggerConditionSetting | undefined {
  const parsed = SETTING_SCHEMAS[kind].safeParse(raw);
  if (!parsed.success) {
    const described = parsed.error.issues.map((issue) =>
      describeIssue(path, issue),
    );
    issues.push(...described);
    return undefined;
  }
  return parsed.data;
}

function parseAnyGroup(
  raw: unknown,
  issues: TriggerConditionsIssue[],
): TriggerConditionSetting[] {
  if (!isPlainMap(raw)) {
    issues.push(makeIssue([ANY_KEY], "expected a map of conditions"));
    return [];
  }

  const settings: TriggerConditionSetting[] = [];
  for (const [key, value] of Object.entries(raw)) {
    if (!isConfigKey(key)) {
      issues.push(makeIssue([ANY_KEY], `unrecognized key ${renderKey(key)}`));
      continue;
    }
    const kind = CONFIG_KEYS[key];
    if (kind === TriggerConditionKinds.NEVER) {
      issues.push(makeIssue([ANY_KEY, key], "never stands alone, outside any"));
      continue;
    }
    if (offSchema.safeParse(value).success) {
      issues.push(
        makeIssue([ANY_KEY, key], "switch a kind off at the top level"),
      );
      continue;
    }
    const setting = parseSetting(kind, value, [ANY_KEY, key], issues);
    if (setting !== undefined) {
      settings.push(setting);
    }
  }

  if (Object.keys(raw).length < MIN_ANY_KINDS) {
    issues.push(makeIssue([ANY_KEY], "name at least two conditions"));
  }
  return settings;
}

function findBlockIssues(
  raw: Record<string, unknown>,
  all: readonly TriggerConditionSetting[],
  any: readonly TriggerConditionSetting[],
  dropped: readonly TriggerConditionKind[],
): TriggerConditionsIssue[] {
  const issues: TriggerConditionsIssue[] = [];
  if (Object.keys(raw).length === 0) {
    issues.push(makeIssue([], "name at least one condition, or write off"));
  }

  const topKinds = new Set(all.map((setting) => setting.kind));
  for (const setting of any) {
    if (topKinds.has(setting.kind)) {
      issues.push(
        makeIssue([], `${setting.kind} is set both in any and outside it`),
      );
    }
    if (dropped.includes(setting.kind)) {
      issues.push(
        makeIssue([], `${setting.kind} is switched off and set in any`),
      );
    }
  }

  const holdsNever = topKinds.has(TriggerConditionKinds.NEVER);
  const neverHasCompany = holdsNever && all.length + any.length > 1;
  if (neverHasCompany) {
    issues.push(
      makeIssue(["never"], "never stands alone; remove the other conditions"),
    );
  }
  return issues;
}

function parseBlock(
  raw: unknown,
  setBy: TriggerConditionSetter,
): Result<TriggerConditionsBlock, readonly TriggerConditionsIssue[]> {
  if (offSchema.safeParse(raw).success) {
    return { ok: true, value: { off: true } };
  }
  if (!isPlainMap(raw)) {
    const issue = makeIssue([], "expected a map of conditions, or off");
    return { ok: false, error: [issue] };
  }

  const issues: TriggerConditionsIssue[] = [];
  const all: TriggerConditionSetting[] = [];
  const dropped: TriggerConditionKind[] = [];
  let any: TriggerConditionSetting[] = [];
  for (const [key, value] of Object.entries(raw)) {
    if (key === ANY_KEY) {
      any = parseAnyGroup(value, issues);
      continue;
    }
    if (!isConfigKey(key)) {
      issues.push(makeIssue([], `unrecognized key ${renderKey(key)}`));
      continue;
    }
    const kind = CONFIG_KEYS[key];
    if (offSchema.safeParse(value).success) {
      dropped.push(kind);
      continue;
    }
    const setting = parseSetting(kind, value, [key], issues);
    if (setting !== undefined) {
      all.push(setting);
    }
  }

  const usesPaths = [...all, ...any].some(
    (setting) => setting.kind === TriggerConditionKinds.PATHS,
  );
  const instanceSetsPaths =
    setBy === TriggerConditionSetters.INSTANCE && usesPaths;
  if (instanceSetsPaths) {
    issues.push(
      makeIssue(["paths"], "set paths in a repository's settings.yaml"),
    );
  }

  issues.push(...findBlockIssues(raw, all, any, dropped));
  if (issues.length > 0) {
    return { ok: false, error: issues };
  }
  return { ok: true, value: { off: false, all, any, dropped } };
}

/** A repository's `.mergebrief/settings.yaml` block. */
export function parseRepoTriggerConditions(
  raw: unknown,
): Result<TriggerConditionsBlock, readonly TriggerConditionsIssue[]> {
  return parseBlock(raw, TriggerConditionSetters.REPO);
}

/** The instance file's block; `paths` is refused there. */
export function parseInstanceTriggerConditions(
  raw: unknown,
): Result<TriggerConditionsBlock, readonly TriggerConditionsIssue[]> {
  return parseBlock(raw, TriggerConditionSetters.INSTANCE);
}

function tagSetBy(
  settings: readonly TriggerConditionSetting[],
  setBy: TriggerConditionSetter,
): EffectiveCondition[] {
  return settings.map((setting) => ({ setting, setBy }));
}

function namesKind(
  block: TriggerConditionsBlock,
  kind: TriggerConditionKind,
): boolean {
  if (block.off) {
    return false;
  }
  const isKind = (setting: TriggerConditionSetting) => setting.kind === kind;
  const blockNamesKind =
    block.dropped.includes(kind) ||
    block.all.some(isKind) ||
    block.any.some(isKind);
  return blockNamesKind;
}

/**
 * Per kind, the repo's setting replaces the instance's, its place (in or
 * out of `any`) travelling with it; a kind the repo never names is
 * inherited. An `any` group left with one member is that member alone.
 */
export function resolveEffectiveTriggerConditions(
  instance: TriggerConditionsBlock | undefined,
  repo: TriggerConditionsBlock | undefined,
): EffectiveTriggerConditions {
  if (repo?.off === true) {
    return { all: [], any: [] };
  }

  const all: EffectiveCondition[] = [];
  const any: EffectiveCondition[] = [];
  if (instance !== undefined && !instance.off) {
    const isInherited = (setting: TriggerConditionSetting) =>
      repo === undefined || !namesKind(repo, setting.kind);
    const inheritedAll = instance.all.filter(isInherited);
    const inheritedAny = instance.any.filter(isInherited);
    all.push(...tagSetBy(inheritedAll, TriggerConditionSetters.INSTANCE));
    any.push(...tagSetBy(inheritedAny, TriggerConditionSetters.INSTANCE));
  }
  if (repo !== undefined) {
    all.push(...tagSetBy(repo.all, TriggerConditionSetters.REPO));
    any.push(...tagSetBy(repo.any, TriggerConditionSetters.REPO));
  }

  if (any.length === 1) {
    return { all: [...all, ...any], any: [] };
  }
  return { all, any };
}

export type {
  BotsSetting,
  CiSetting,
  EffectiveCondition,
  EffectiveTriggerConditions,
  SizeBounds,
  SizeSetting,
  TriggerConditionSetting,
  TriggerConditionsBlock,
  TriggerConditionsIssue,
} from "./types";
export { ANY_KEY, CONFIG_KEYS } from "./schemas";
export { CiModes } from "./types";
