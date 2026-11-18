/** The two baseline files this gate holds, relative to the repository root. */
export const SUPPRESSIONS_PATH = "oxlint-suppressions.json";
export const BOUNDARY_RECORDS_PATH =
  ".dependency-cruiser-known-violations.json";

/** The oxlint configuration, read to tell a policy retirement from a fix. */
export const LINT_CONFIG_PATH = ".oxlintrc.json";

/** The root manifest, read to prove the boundary escape hatch stays unwired. */
export const ROOT_MANIFEST_PATH = "package.json";

/** The dependency-cruiser flag that suppresses recorded boundary violations. */
export const BOUNDARY_IGNORE_FLAG = "--ignore-known";

/** The base ref used when neither the flag nor the environment names one. */
export const DEFAULT_BASE_REF = "main";

/** Names the base ref for CI, where the PR base is not `main` by construction. */
export const BASE_REF_ENV_VAR = "MERGEBRIEF_BASELINE_BASE";
