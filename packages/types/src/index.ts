// Shared type helpers and closed-vocabulary maps.
//
// Zero dependencies. Runtime is `as const` maps only: no functions, no
// classes, no other values. `house/types-const-maps` holds that.
export type {
  Brand,
  Equals,
  MaybePromise,
  Mutable,
  Result,
  ValueOf,
} from "./utils";
export { CommentAnchorKinds, type CommentAnchorKind } from "./comments";

/** Parsed from `mergebrief.config.yaml`'s `drafts` block. Default lives in generators. */
export interface DraftPolicy {
  readonly generate: boolean;
  readonly debounceSeconds: number | null;
}

/**
 * Enqueue-to-drain handshake between persistence and worker. Snake_case JSON
 * in a Postgres row; string ids because JSON cannot carry bigint. Change only
 * with both sides in the same commit.
 */
export interface InstallationGenerateJobPayload {
  readonly installation_id: string;
  readonly pull_request_id: string;
  readonly head_sha: string;
}

export interface UrlBoxGenerateJobPayload {
  readonly owner_user_id: string;
  readonly grant_id: string;
  readonly pull_request_id: string;
  readonly head_sha: string;
}

export type GenerateJobPayload =
  | InstallationGenerateJobPayload
  | UrlBoxGenerateJobPayload;
