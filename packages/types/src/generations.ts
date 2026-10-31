import type { ValueOf } from "./utils";

/**
 * `superseded` = a mid-call generation aborted because the PR head advanced;
 * `capped` = a skip because the instance hit its daily generation cap;
 * `awaiting-trigger` = held until a collaborator approves the PR's runs.
 * None is a failure; each is terminal and consumes no attempt.
 */
export const GenerationStatuses = {
  PENDING: "pending",
  RUNNING: "running",
  SUCCEEDED: "succeeded",
  FAILED: "failed",
  SUPERSEDED: "superseded",
  CAPPED: "capped",
  AWAITING_TRIGGER: "awaiting-trigger",
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
  /** The provider account reached a spend limit; a rerun helps once it is raised or resets. */
  PROVIDER_SPEND_LIMIT: "provider-spend-limit",
  OUTPUT_INVALID: "output-invalid",
  OUTPUT_SECRET: "output-secret",
  /** The output reached its token cap before it finished; a rerun is cut the same way. */
  OUTPUT_CUT: "output-cut",
  GENERATION_CONFIG: "generation-config",
  GITHUB_ACCESS: "github-access",
  DIFF_TOO_LARGE: "diff-too-large",
  GITHUB_UNAVAILABLE: "github-unavailable",
  ATTEMPTS_EXHAUSTED: "attempts-exhausted",
  UNKNOWN: "unknown",
} as const;
export type GenerationFailureCode = ValueOf<typeof GenerationFailureCodes>;

/**
 * What a pusher can do about a failed brief: run it again, fix something
 * first, or nothing, since a rerun fails the same way and still spends.
 */
export const GenerationFailureClasses = {
  TRANSIENT: "transient",
  FIX_FIRST: "fix-first",
  CANNOT_HELP: "cannot-help",
} as const;
export type GenerationFailureClass = ValueOf<typeof GenerationFailureClasses>;

export const GenerationFailureClassByCode = {
  [GenerationFailureCodes.PROVIDER_AUTH]: GenerationFailureClasses.FIX_FIRST,
  [GenerationFailureCodes.PROVIDER_RATE_LIMIT]:
    GenerationFailureClasses.TRANSIENT,
  [GenerationFailureCodes.PROVIDER_TIMEOUT]: GenerationFailureClasses.TRANSIENT,
  [GenerationFailureCodes.PROVIDER_UNAVAILABLE]:
    GenerationFailureClasses.TRANSIENT,
  [GenerationFailureCodes.PROVIDER_REFUSAL]:
    GenerationFailureClasses.CANNOT_HELP,
  [GenerationFailureCodes.PROVIDER_SPEND_LIMIT]:
    GenerationFailureClasses.FIX_FIRST,
  [GenerationFailureCodes.OUTPUT_INVALID]: GenerationFailureClasses.TRANSIENT,
  [GenerationFailureCodes.OUTPUT_SECRET]: GenerationFailureClasses.CANNOT_HELP,
  [GenerationFailureCodes.OUTPUT_CUT]: GenerationFailureClasses.CANNOT_HELP,
  [GenerationFailureCodes.GENERATION_CONFIG]:
    GenerationFailureClasses.FIX_FIRST,
  [GenerationFailureCodes.GITHUB_ACCESS]: GenerationFailureClasses.FIX_FIRST,
  [GenerationFailureCodes.DIFF_TOO_LARGE]: GenerationFailureClasses.CANNOT_HELP,
  [GenerationFailureCodes.GITHUB_UNAVAILABLE]:
    GenerationFailureClasses.TRANSIENT,
  [GenerationFailureCodes.ATTEMPTS_EXHAUSTED]:
    GenerationFailureClasses.TRANSIENT,
  [GenerationFailureCodes.UNKNOWN]: GenerationFailureClasses.TRANSIENT,
} as const satisfies Record<GenerationFailureCode, GenerationFailureClass>;

/** A failure code's template param, pre-sanitized. */
export interface GenerationDetailParams {
  readonly detail: string;
}

/** A large run the cap refused: the units it still needed and what the day had left. */
export interface GenerationUnitsParams {
  readonly needed: number;
  readonly left: number;
  /** The daily cap it ran against. A run's claim takes one unit first, so `needed` at or past it fits no day. */
  readonly cap: number;
}

/** A failed row carries `detail`; a capped large run carries its units. */
export type GenerationFailureParams =
  | GenerationDetailParams
  | GenerationUnitsParams;

/**
 * Where a head's takeover job stands: waiting for a lapsed claim, running, or
 * out of graphile attempts with nothing left to take the head over.
 */
export const TakeoverJobStates = {
  SCHEDULED: "scheduled",
  RUNNING: "running",
  SPENT: "spent",
} as const;
export type TakeoverJobState = ValueOf<typeof TakeoverJobStates>;

/** How a generation used the prior brief: anchored to it, restarted fresh, or had none. */
export const AnchorStates = {
  ANCHORED: "anchored",
  FRESH_RESTART: "fresh-restart",
  NONE: "none",
} as const;
export type AnchorState = ValueOf<typeof AnchorStates>;

/** Why an anchored-capable generation ran fresh instead. */
export const FreshRestartReasons = {
  /** `full-regeneration: on-model-swap` fired; stamped provider/model moved. */
  MODEL_SWAP: "model-swap",
} as const;
export type FreshRestartReason = ValueOf<typeof FreshRestartReasons>;
