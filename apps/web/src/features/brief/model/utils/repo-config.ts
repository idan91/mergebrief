// Display weights use the stored generation-time snapshot, never live policy.
// Local types avoid pulling the generator engine into the browser bundle; the
// path matcher comes from its owner, which is browser-safe on its own subpath.
// A lockstep test still pins the mirrored floor list.
import { matchesGlob } from "brief-core/path-matching";

export type RepoConfigOutcome =
  | "applied"
  | "absent"
  | "invalid"
  | "over-budget"
  | "fetch-failed";

export const OUTCOMES = [
  "applied",
  "absent",
  "invalid",
  "over-budget",
  "fetch-failed",
] as const satisfies readonly RepoConfigOutcome[];

export interface RepoConfigFileOutcome {
  path: string;
  blobSha: string | null;
  outcome: RepoConfigOutcome;
  detail?: string;
  bytesUsed?: number;
  bytesBudget?: number;
  warning?: string;
}

export interface FiredCustomAttribute {
  name: string;
  criteria: string;
  implication?: string;
  paths?: string[];
}

export interface DeEmphasisRule {
  attribute: string;
  paths?: string[];
}

export interface RepoConfigPolicySnapshot {
  firedCustomAttributes: FiredCustomAttribute[];
  deEmphasize: DeEmphasisRule[];
}

/** The `brief.repo_config` snapshot as served by /brief-context. */
export interface RepoConfigContext {
  files: RepoConfigFileOutcome[];
  collisions: string[];
  policy: RepoConfigPolicySnapshot | null;
}

/**
 * Floor attributes, can never be de-emphasized, pinned first in every chip
 * ordering. Mirrors `repo-config`'s FLOOR_ATTRIBUTES (lockstep-tested).
 */
export const FLOOR_ATTRIBUTES = [
  "touches-auth",
  "removes-validation",
  "relaxes-permissions",
] as const;

const FLOOR_SET: ReadonlySet<string> = new Set(FLOOR_ATTRIBUTES);

export function isFloorAttribute(attr: string): boolean {
  return FLOOR_SET.has(attr);
}

// ---------------------------------------------------------------------------
// Wire vocabulary the snapshot schema (`../schemas`) checks against.
// ---------------------------------------------------------------------------

/** Canonical slot paths, in the ONLY accepted order (mirrors the artifact schema). */
export const SLOT_PATHS = [
  ".mergebrief/instructions.md",
  ".mergebrief/settings.yaml",
  ".mergebrief/policy.yaml",
] as const;

export const NAME_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
export const NAME_MAX_CHARS = 50;
export const CRITERIA_MAX_CHARS = 4000;
export const IMPLICATION_MAX_CHARS = 500;

function ruleAppliesTo(rule: DeEmphasisRule, file: string): boolean {
  if (rule.paths === undefined || rule.paths.length === 0) {
    return true;
  }
  return rule.paths.some((pattern) => matchesGlob(pattern, file));
}

// ---------------------------------------------------------------------------
// Display-weight resolution.
// ---------------------------------------------------------------------------

export type AttributeSource = "built-in" | "repo-policy";

export interface AttributeDisplayMeta {
  source: AttributeSource;
  /** Quiet render + jump-rail exclusion; NEVER true for a floor attribute. */
  deEmphasized: boolean;
  /** Repo-authored reviewer hint, custom attributes only (chip expansion). */
  implication?: string;
  /** The repo's model-evaluated criteria, the custom chip's description. */
  criteria?: string;
}

const BUILT_IN_META: AttributeDisplayMeta = {
  source: "built-in",
  deEmphasized: false,
};

/**
 * Resolve one attribute's display weight on one chunk. The floor co-fire
 * rule lives HERE: a de-emphasized attribute on a chunk that also fires a
 * floor attribute renders un-quieted, the combination is the signal.
 */
export function attributeDisplayMeta(
  context: RepoConfigContext | null | undefined,
  attr: string,
  file: string,
  chunkFiresFloor: boolean,
): AttributeDisplayMeta {
  if (context === null || context === undefined || context.policy === null) {
    return BUILT_IN_META;
  }
  const fired = context.policy.firedCustomAttributes.find(
    (f) => f.name === attr,
  );
  const deEmphasized =
    !isFloorAttribute(attr) &&
    !chunkFiresFloor &&
    context.policy.deEmphasize.some(
      (rule) => rule.attribute === attr && ruleAppliesTo(rule, file),
    );
  if (fired === undefined) {
    return deEmphasized
      ? { source: "built-in", deEmphasized: true }
      : BUILT_IN_META;
  }
  const meta: AttributeDisplayMeta = {
    source: "repo-policy",
    deEmphasized,
    criteria: fired.criteria,
  };

  if (fired.implication !== undefined) {
    meta.implication = fired.implication;
  }

  return meta;
}

/**
 * Order attribute names for a chip row: floor attributes first (in their
 * declared order), everything else in first-appearance order. Never a
 * severity ranking, floor pinning is disclosure, not scoring.
 */
export function floorFirst(attrs: readonly string[]): string[] {
  const floors = FLOOR_ATTRIBUTES.filter((floor) => attrs.includes(floor));
  const rest = attrs.filter((attr) => !isFloorAttribute(attr));
  return [...floors, ...rest];
}
