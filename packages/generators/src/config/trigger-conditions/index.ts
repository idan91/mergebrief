import type { z } from "zod/v4";
import {
  TriggerConditionKinds,
  TriggerConditionSources,
  type TriggerConditionKind,
  type TriggerConditionSource,
} from "types/trigger-conditions";
import type { Result } from "types/utils";

import { configError, type ConfigError } from "../../contract/errors";
import { renderKey } from "../render-key";
import { ANY_KEY, CONFIG_KEYS, SETTING_SCHEMAS, offSchema } from "./schemas";
import type {
  EffectiveTriggerConditions,
  SourcedCondition,
  TriggerConditionSetting,
  TriggerConditionsBlock,
} from "./types";

const BLOCK = "triggerConditions";
const MIN_ANY_KINDS = 2;

function isConfigKey(key: string): key is keyof typeof CONFIG_KEYS {
  return Object.hasOwn(CONFIG_KEYS, key);
}

function isPlainMap(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function describeIssue(where: string, issue: z.core.$ZodIssue): string {
  const path = issue.path.map((segment) => renderKey(String(segment)));
  const at = path.length > 0 ? `.${path.join(".")}` : "";
  return `${where}${at}: ${issue.code === "unrecognized_keys" ? "unrecognized key" : issue.message}`;
}

function parseSetting(
  kind: TriggerConditionKind,
  raw: unknown,
  where: string,
  issues: string[],
): TriggerConditionSetting | undefined {
  const parsed = SETTING_SCHEMAS[kind].safeParse(raw);
  if (!parsed.success) {
    issues.push(
      ...parsed.error.issues.map((issue) => describeIssue(where, issue)),
    );
    return undefined;
  }
  return parsed.data;
}

function parseAnyGroup(
  raw: unknown,
  issues: string[],
): TriggerConditionSetting[] {
  const where = `${BLOCK}.${ANY_KEY}`;
  if (!isPlainMap(raw)) {
    issues.push(`${where}: expected a map of conditions`);
    return [];
  }

  const settings: TriggerConditionSetting[] = [];
  for (const [key, value] of Object.entries(raw)) {
    if (!isConfigKey(key)) {
      issues.push(`${where}: unrecognized key ${renderKey(key)}`);
      continue;
    }
    const kind = CONFIG_KEYS[key];
    if (kind === TriggerConditionKinds.NEVER) {
      issues.push(`${where}.never: never stands alone, outside any`);
      continue;
    }
    if (offSchema.safeParse(value).success) {
      issues.push(`${where}.${key}: switch a kind off at the top level`);
      continue;
    }
    const setting = parseSetting(kind, value, `${where}.${key}`, issues);
    if (setting !== undefined) {
      settings.push(setting);
    }
  }

  if (Object.keys(raw).length < MIN_ANY_KINDS) {
    issues.push(`${where}: name at least two conditions`);
  }
  return settings;
}

function findBlockIssues(
  all: readonly TriggerConditionSetting[],
  any: readonly TriggerConditionSetting[],
  dropped: readonly TriggerConditionKind[],
): string[] {
  const issues: string[] = [];
  if (all.length + any.length + dropped.length === 0) {
    issues.push(`${BLOCK}: name at least one condition, or write off`);
  }

  const topKinds = new Set(all.map((setting) => setting.kind));
  for (const setting of any) {
    if (topKinds.has(setting.kind)) {
      issues.push(
        `${BLOCK}: ${setting.kind} is set both in any and outside it`,
      );
    }
  }

  const holdsNever = topKinds.has(TriggerConditionKinds.NEVER);
  if (holdsNever && all.length + any.length > 1) {
    issues.push(
      `${BLOCK}.never: never stands alone; remove the other conditions`,
    );
  }
  return issues;
}

function parseBlock(
  raw: unknown,
  scope: TriggerConditionSource,
): Result<TriggerConditionsBlock, ConfigError> {
  if (offSchema.safeParse(raw).success) {
    return { ok: true, value: { off: true } };
  }
  if (!isPlainMap(raw)) {
    return configError([`${BLOCK}: expected a map of conditions, or off`]);
  }

  const issues: string[] = [];
  const all: TriggerConditionSetting[] = [];
  const dropped: TriggerConditionKind[] = [];
  let any: TriggerConditionSetting[] = [];
  for (const [key, value] of Object.entries(raw)) {
    if (key === ANY_KEY) {
      any = parseAnyGroup(value, issues);
      continue;
    }
    if (!isConfigKey(key)) {
      issues.push(`${BLOCK}: unrecognized key ${renderKey(key)}`);
      continue;
    }
    const kind = CONFIG_KEYS[key];
    if (offSchema.safeParse(value).success) {
      dropped.push(kind);
      continue;
    }
    const setting = parseSetting(kind, value, `${BLOCK}.${key}`, issues);
    if (setting !== undefined) {
      all.push(setting);
    }
  }

  const usesPaths = [...all, ...any].some(
    (setting) => setting.kind === TriggerConditionKinds.PATHS,
  );
  if (scope === TriggerConditionSources.INSTANCE && usesPaths) {
    issues.push(`${BLOCK}.paths: set paths in a repository's settings.yaml`);
  }

  issues.push(...findBlockIssues(all, any, dropped));
  if (issues.length > 0) {
    return configError(issues);
  }
  return { ok: true, value: { off: false, all, any, dropped } };
}

/** A repository's `.mergebrief/settings.yaml` block. */
export function parseRepoTriggerConditions(
  raw: unknown,
): Result<TriggerConditionsBlock, ConfigError> {
  return parseBlock(raw, TriggerConditionSources.REPO);
}

/** The instance file's block; `paths` is refused there. */
export function parseInstanceTriggerConditions(
  raw: unknown,
): Result<TriggerConditionsBlock, ConfigError> {
  return parseBlock(raw, TriggerConditionSources.INSTANCE);
}

function tagSource(
  settings: readonly TriggerConditionSetting[],
  source: TriggerConditionSource,
): SourcedCondition[] {
  return settings.map((setting) => ({ setting, source }));
}

function namesKind(
  block: TriggerConditionsBlock,
  kind: TriggerConditionKind,
): boolean {
  if (block.off) {
    return false;
  }
  return (
    block.dropped.includes(kind) ||
    block.all.some((setting) => setting.kind === kind) ||
    block.any.some((setting) => setting.kind === kind)
  );
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

  const all: SourcedCondition[] = [];
  const any: SourcedCondition[] = [];
  if (instance !== undefined && !instance.off) {
    const isInherited = (setting: TriggerConditionSetting) =>
      repo === undefined || !namesKind(repo, setting.kind);
    const inheritedAll = instance.all.filter(isInherited);
    const inheritedAny = instance.any.filter(isInherited);
    all.push(...tagSource(inheritedAll, TriggerConditionSources.INSTANCE));
    any.push(...tagSource(inheritedAny, TriggerConditionSources.INSTANCE));
  }
  if (repo !== undefined) {
    all.push(...tagSource(repo.all, TriggerConditionSources.REPO));
    any.push(...tagSource(repo.any, TriggerConditionSources.REPO));
  }

  if (any.length === 1) {
    return { all: [...all, ...any], any: [] };
  }
  return { all, any };
}

export type {
  BotsSetting,
  CiSetting,
  EffectiveTriggerConditions,
  SizeBounds,
  SizeSetting,
  SourcedCondition,
  TriggerConditionSetting,
  TriggerConditionsBlock,
} from "./types";
export { CiModes, SizeMeasures } from "./types";
