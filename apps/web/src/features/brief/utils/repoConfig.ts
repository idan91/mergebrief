// Display weights use the stored generation-time snapshot, never live policy.
// Local types avoid pulling the generator engine into the browser bundle; the
// path matcher comes from its owner, which is browser-safe on its own subpath.
// A lockstep test still pins the mirrored floor list.
import { matchesGlob } from "brief-core/path-matching";

import type { Result } from "./validation";

export type RepoConfigOutcome =
  | "applied"
  | "absent"
  | "invalid"
  | "over-budget"
  | "fetch-failed";

export const OUTCOMES: readonly RepoConfigOutcome[] = [
  "applied",
  "absent",
  "invalid",
  "over-budget",
  "fetch-failed",
];

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
// Wire parsing (hand-rolled, matching validation.ts's posture).
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function optionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

function optionalStringArray(value: unknown): value is string[] | undefined {
  return value === undefined || (Array.isArray(value) && value.every(isString));
}

function parseFileOutcome(value: unknown): RepoConfigFileOutcome | undefined {
  if (!isRecord(value)) return undefined;
  const { path, blobSha, outcome } = value;
  if (!isString(path)) return undefined;
  if (blobSha !== null && !isString(blobSha)) return undefined;
  if (!isString(outcome) || !OUTCOMES.some((known) => known === outcome)) {
    return undefined;
  }
  const detail = value["detail"];
  const warning = value["warning"];
  if (!optionalString(detail) || !optionalString(warning)) return undefined;
  const bytesUsed = value["bytesUsed"];
  const bytesBudget = value["bytesBudget"];
  if (bytesUsed !== undefined && typeof bytesUsed !== "number")
    return undefined;
  if (bytesBudget !== undefined && typeof bytesBudget !== "number")
    return undefined;
  const fileOutcome: RepoConfigFileOutcome = {
    path,
    blobSha,
    // Membership checked against OUTCOMES above; narrow via find, not a cast.
    outcome: OUTCOMES.find((known) => known === outcome) ?? "invalid",
  };

  if (detail !== undefined) fileOutcome.detail = detail;
  if (warning !== undefined) fileOutcome.warning = warning;
  if (bytesUsed !== undefined) fileOutcome.bytesUsed = bytesUsed;
  if (bytesBudget !== undefined) fileOutcome.bytesBudget = bytesBudget;

  return fileOutcome;
}

function parseFired(value: unknown): FiredCustomAttribute | undefined {
  if (!isRecord(value)) return undefined;
  const { name, criteria } = value;
  const implication = value["implication"];
  const paths = value["paths"];
  if (
    !isString(name) ||
    name.length > NAME_MAX_CHARS ||
    !NAME_PATTERN.test(name) ||
    !isString(criteria) ||
    criteria.length === 0 ||
    criteria.length > CRITERIA_MAX_CHARS
  ) {
    return undefined;
  }
  if (!optionalString(implication) || !optionalStringArray(paths))
    return undefined;
  if (
    implication !== undefined &&
    (implication.length === 0 || implication.length > IMPLICATION_MAX_CHARS)
  ) {
    return undefined;
  }
  if (paths !== undefined && paths.some((entry) => entry.length === 0)) {
    return undefined;
  }
  const fired: FiredCustomAttribute = { name, criteria };

  if (implication !== undefined) fired.implication = implication;
  if (paths !== undefined) fired.paths = paths;

  return fired;
}

function parseRule(value: unknown): DeEmphasisRule | undefined {
  if (!isRecord(value)) return undefined;
  const { attribute } = value;
  const paths = value["paths"];
  if (!isString(attribute) || !optionalStringArray(paths)) return undefined;
  const rule: DeEmphasisRule = { attribute };

  if (paths !== undefined) rule.paths = paths;

  return rule;
}

/**
 * Parse the /brief-context envelope `{ repoConfig: <snapshot|null> }`.
 * `null` (generation recorded nothing) is a valid result, every affordance
 * then renders as if no repo config exists.
 */
export function parseBriefContext(
  value: unknown,
): Result<RepoConfigContext | null> {
  if (!isRecord(value)) {
    return { ok: false, error: "Expected a brief-context object" };
  }
  const snapshot = value["repoConfig"];
  if (snapshot === null) return { ok: true, value: null };
  if (!isRecord(snapshot)) {
    return { ok: false, error: "Expected repoConfig to be an object or null" };
  }
  const filesRaw = snapshot["files"];
  const collisions = snapshot["collisions"];
  const policyRaw = snapshot["policy"];
  if (!Array.isArray(filesRaw)) {
    return { ok: false, error: "Expected repoConfig.files array" };
  }
  // Exactly the three canonical slots, in order, a snapshot the writer's
  // schema would reject must not drive display metadata.
  if (filesRaw.length !== SLOT_PATHS.length) {
    return { ok: false, error: "Expected exactly three repoConfig file slots" };
  }
  const files: RepoConfigFileOutcome[] = [];
  for (const [index, entry] of filesRaw.entries()) {
    const parsed = parseFileOutcome(entry);
    if (parsed === undefined || parsed.path !== SLOT_PATHS[index]) {
      return { ok: false, error: "Malformed repoConfig file outcome" };
    }
    files.push(parsed);
  }
  if (!Array.isArray(collisions) || !collisions.every(isString)) {
    return { ok: false, error: "Expected repoConfig.collisions string array" };
  }
  let policy: RepoConfigPolicySnapshot | null = null;
  if (policyRaw !== null) {
    if (!isRecord(policyRaw)) {
      return { ok: false, error: "Expected repoConfig.policy object or null" };
    }
    const firedRaw = policyRaw["firedCustomAttributes"];
    const rulesRaw = policyRaw["deEmphasize"];
    if (!Array.isArray(firedRaw) || !Array.isArray(rulesRaw)) {
      return { ok: false, error: "Malformed repoConfig.policy" };
    }
    const firedCustomAttributes: FiredCustomAttribute[] = [];
    for (const entry of firedRaw) {
      const parsed = parseFired(entry);
      if (parsed === undefined) {
        return { ok: false, error: "Malformed fired custom attribute" };
      }
      firedCustomAttributes.push(parsed);
    }
    const deEmphasize: DeEmphasisRule[] = [];
    for (const entry of rulesRaw) {
      const parsed = parseRule(entry);
      if (parsed === undefined) {
        return { ok: false, error: "Malformed de-emphasis rule" };
      }
      if (isFloorAttribute(parsed.attribute)) {
        // The writer's schema forbids this; a snapshot carrying it is not
        // trustworthy display input (display ALSO refuses per-attribute).
        return { ok: false, error: "Snapshot de-emphasizes a floor attribute" };
      }
      deEmphasize.push(parsed);
    }
    policy = { firedCustomAttributes, deEmphasize };
  }
  return { ok: true, value: { files, collisions, policy } };
}

export { matchesGlob };

function ruleAppliesTo(rule: DeEmphasisRule, file: string): boolean {
  if (rule.paths === undefined || rule.paths.length === 0) return true;
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

  if (fired.implication !== undefined) meta.implication = fired.implication;

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
