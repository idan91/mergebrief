import type { ValueOf } from "./utils";

/**
 * `superseded` = a mid-call generation aborted because the PR head advanced;
 * `capped` = a skip because the instance hit its daily generation cap.
 * Neither is a failure; both are terminal and consume no attempt.
 */
export const GenerationStatuses = {
  PENDING: "pending",
  RUNNING: "running",
  SUCCEEDED: "succeeded",
  FAILED: "failed",
  SUPERSEDED: "superseded",
  CAPPED: "capped",
} as const;
export type GenerationStatus = ValueOf<typeof GenerationStatuses>;

/** Optional determinate-progress detail on a generation. */
export const GenerationPhases = {
  FETCHING: "fetching",
  REDACTING: "redacting",
  GENERATING: "generating",
  WRITING: "writing",
} as const;
export type GenerationPhase = ValueOf<typeof GenerationPhases>;

/**
 * The stored failure vocabulary, distinct from persistence's store-internal
 * `GenerationErrorCodes`. The web catalog renders `generationError.<code>`;
 * a new code also needs its catalog key, the web vocab mirror and a CHECK
 * migration.
 */
export const GenerationFailureCodes = {
  PROVIDER_AUTH: "provider-auth",
  PROVIDER_RATE_LIMIT: "provider-rate-limit",
  PROVIDER_TIMEOUT: "provider-timeout",
  PROVIDER_UNAVAILABLE: "provider-unavailable",
  PROVIDER_REFUSAL: "provider-refusal",
  OUTPUT_INVALID: "output-invalid",
  GENERATION_CONFIG: "generation-config",
  GITHUB_ACCESS: "github-access",
  DIFF_TOO_LARGE: "diff-too-large",
  GITHUB_UNAVAILABLE: "github-unavailable",
  UNKNOWN: "unknown",
} as const;
export type GenerationFailureCode = ValueOf<typeof GenerationFailureCodes>;

/** A failure's interpolation params (today: detail only). */
export interface GenerationFailureParams {
  readonly detail: string;
}
