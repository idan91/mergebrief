import type { ValueOf } from "types/utils";

export const REPO_CONFIG_DIR = ".mergebrief";

export const RepoConfigPaths = {
  INSTRUCTIONS: ".mergebrief/instructions.md",
  SETTINGS: ".mergebrief/settings.yaml",
  POLICY: ".mergebrief/policy.yaml",
} as const;

// --- Budget caps; schema constants, versioned with the schema. Byte caps
// are UTF-8 byte length; char caps are string length. Boundaries are
// inclusive: == cap applies, cap+1 is over-budget.

export const INSTRUCTIONS_BUDGET_BYTES = 16 * 1024;
export const SETTINGS_MAX_BYTES = 4 * 1024;
export const POLICY_MAX_BYTES = 32 * 1024;
export const CRITERIA_MAX_CHARS = 4000;
export const IMPLICATION_MAX_CHARS = 500;
export const MAX_CUSTOM_ATTRIBUTES = 20;
export const ATTRIBUTE_NAME_MAX_CHARS = 50;
export const BUDGET_WARN_FRACTION = 0.8;

/**
 * Custom attribute NAME charset: lower-kebab, must start with a letter. These
 * names later extend a model json_schema enum per generation; the charset
 * restriction is a SECURITY CONTROL, not cosmetics. Anything else is rejected
 * (whole-file invalid).
 */
export const ATTRIBUTE_NAME_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

/**
 * Floor risk attributes: can be neither suppressed nor de-emphasized. A
 * `deEmphasize` entry naming one of these invalidates the whole policy file.
 */
export const FLOOR_ATTRIBUTES = [
  "touches-auth",
  "removes-validation",
  "relaxes-permissions",
] as const;

export const PARKED_ATTRIBUTE_CANDIDATES = [
  "unresolved-reference",
  "diverges-from-sibling-pattern",
] as const;

export const RESERVED_ATTRIBUTE_WORDS = ["uncertain"] as const;

/**
 * Per-file outcome vocabulary. `fetch-failed` is stamped by the worker
 * (fail-open on a GitHub 5xx), never by validation; it lives here so the
 * whole vocabulary has one home.
 */
export const RepoConfigOutcomes = {
  APPLIED: "applied",
  ABSENT: "absent",
  INVALID: "invalid",
  OVER_BUDGET: "over-budget",
  FETCH_FAILED: "fetch-failed",
} as const;

export type RepoConfigOutcome = ValueOf<typeof RepoConfigOutcomes>;
