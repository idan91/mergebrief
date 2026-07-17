// Fixed vocabulary and schema constants for the `.mergebrief/` repo-local
// config surface (ADR 0032). Everything here is versioned WITH the schema —
// changing a cap or a path is a deliberate versioned change, never incidental.

import type { ValueOf } from "types";

/** The one repo-local config namespace — nothing lives outside it (ADR 0032 #2). */
export const REPO_CONFIG_DIR = ".mergebrief";

/**
 * The three fixed paths honored on the default branch (ADR 0032 #2/#3). No
 * discovery, no globbing — the loader reads exactly these, in this order.
 */
export const RepoConfigPaths = {
  INSTRUCTIONS: ".mergebrief/instructions.md",
  SETTINGS: ".mergebrief/settings.yaml",
  POLICY: ".mergebrief/policy.yaml",
} as const;

// --- Budget caps (ADR 0032 #6) — schema constants, versioned with the schema.
// Byte caps are UTF-8 byte length; char caps are string length.

/** `instructions.md` injected-content budget: 16 KB. */
export const INSTRUCTIONS_BUDGET_BYTES = 16 * 1024;
/** `settings.yaml` file cap: 4 KB. */
export const SETTINGS_MAX_BYTES = 4 * 1024;
/** `policy.yaml` file cap: 32 KB. */
export const POLICY_MAX_BYTES = 32 * 1024;
/** Per-attribute `criteria` string cap (characters). */
export const CRITERIA_MAX_CHARS = 4000;
/** Per-attribute `implication` string cap (characters). */
export const IMPLICATION_MAX_CHARS = 500;
/** Maximum custom attributes in one `policy.yaml`. */
export const MAX_CUSTOM_ATTRIBUTES = 20;
/** Maximum length of a custom attribute NAME (characters). */
export const ATTRIBUTE_NAME_MAX_CHARS = 50;
/**
 * Fraction of any budget at/above which an applied file gets a nearing-the-cap
 * warning (warn-before-reject, ADR 0032 #6).
 */
export const BUDGET_WARN_FRACTION = 0.8;

/**
 * Custom attribute NAME charset (ADR 0032 #11): lower-kebab, must start with a
 * letter. These names later extend a model json_schema enum per generation —
 * the charset restriction is a security control, not cosmetics. Anything else
 * is rejected (whole-file invalid).
 */
export const ATTRIBUTE_NAME_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

/**
 * Floor risk attributes (ADR 0032 #11, declared in risk-surface.md): can be
 * neither suppressed nor de-emphasized. A `deEmphasize` entry naming one of
 * these invalidates the whole policy file.
 */
export const FLOOR_ATTRIBUTES = [
  "touches-auth",
  "removes-validation",
  "relaxes-permissions",
] as const;

/**
 * Parked risk-attribute candidates (risk-surface.md / ADR 0026): registered so
 * labelers don't reinvent them, not valid tokens yet. A custom attribute that
 * collides with one of these fails toward built-in semantics (dropped + chip).
 * This package is their first code home.
 */
export const PARKED_ATTRIBUTE_CANDIDATES = [
  "unresolved-reference",
  "diverges-from-sibling-pattern",
] as const;

/**
 * Reserved words a custom attribute name may not claim (ADR 0032 #11):
 * `uncertain` is a Brief-schema field name, not a risk attribute. Collision =
 * dropped + chip (fails toward built-in semantics).
 */
export const RESERVED_ATTRIBUTE_WORDS = ["uncertain"] as const;

/**
 * Per-file outcome vocabulary (ADR 0032 #5/#8). `fetch-failed` is stamped by
 * the worker (fail-open on a GitHub 5xx), never by validation — it lives here
 * so the whole vocabulary has one home.
 */
export const RepoConfigOutcome = {
  APPLIED: "applied",
  ABSENT: "absent",
  INVALID: "invalid",
  OVER_BUDGET: "over-budget",
  FETCH_FAILED: "fetch-failed",
} as const;

export type RepoConfigOutcome = ValueOf<typeof RepoConfigOutcome>;
