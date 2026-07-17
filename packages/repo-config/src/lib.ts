/**
 * ENTRY POINT — the repo-config package's ONLY export (`package.json`
 * `exports["."]`). Everything importable from `"repo-config"` is re-exported
 * here, grouped by the module it lives in. Map + invariants: `AGENTS.md`.
 *
 * The package (ADR 0032): the `.mergebrief/` repo-local config surface —
 * Zod schemas + budget caps + the pure, source-agnostic `validateRepoConfig`
 * (reject-whole, collision resolution, outcome model) that the generator
 * consumes.
 */

// --- constants.ts — fixed paths, caps, vocabulary, outcome map --------------
export {
  ATTRIBUTE_NAME_MAX_CHARS,
  ATTRIBUTE_NAME_PATTERN,
  BUDGET_WARN_FRACTION,
  CRITERIA_MAX_CHARS,
  FLOOR_ATTRIBUTES,
  IMPLICATION_MAX_CHARS,
  INSTRUCTIONS_BUDGET_BYTES,
  MAX_CUSTOM_ATTRIBUTES,
  PARKED_ATTRIBUTE_CANDIDATES,
  POLICY_MAX_BYTES,
  REPO_CONFIG_DIR,
  RepoConfigOutcome,
  RepoConfigPaths,
  RESERVED_ATTRIBUTE_WORDS,
  SETTINGS_MAX_BYTES,
} from "./constants";

// --- schemas.ts — Zod schemas + inferred types ------------------------------
export {
  customAttributeSchema,
  deEmphasisRuleSchema,
  policyV1Schema,
  settingsV1Schema,
  type CustomAttribute,
  type DeEmphasisRule,
  type RepoPolicyV1,
  type RepoSettingsV1,
} from "./schemas";

// --- validate.ts — the pure validation contract (PRs 3–6 consume it) --------
export {
  validateRepoConfig,
  type RepoConfigFileInput,
  type RepoConfigFileOutcome,
  type RepoConfigInput,
  type ValidatedInstructions,
  type ValidatedRepoConfig,
  type ValidatedRepoPolicy,
} from "./validate";
