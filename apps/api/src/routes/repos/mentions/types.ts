import type { GitHubCallFailure } from "github";
import type { Logger } from "logging";
import type { FailureKinds } from "../../../shared-errors/failures";
import type { TtlCache } from "../../ttl-cache";

export interface MentionsDeps {
  /** Serialized answers keyed by viewer, repo and request; never shared across viewers. */
  readonly cache: TtlCache<string>;
  readonly log: Logger;
}

/** The gate's verified slug would not split into owner and name. */
export interface MentionsNotFoundFailure {
  readonly kind: "not-found";
}

/** The viewer's token is dead; every other GitHub refusal answers empty. */
export interface MentionsDeniedFailure {
  readonly kind: typeof FailureKinds.GITHUB_DENIED;
  readonly error: GitHubCallFailure;
}

export type MentionsFailure = MentionsNotFoundFailure | MentionsDeniedFailure;
