import type { ValueOf } from "./utils";

/** The graphile task ids persistence enqueues and the worker registers. */
export const QueueTasks = {
  GENERATE: "generate",
  RECOVER_GENERATION: "recover-generation",
} as const;
export type QueueTask = ValueOf<typeof QueueTasks>;

/**
 * Enqueue-to-drain handshake between persistence and worker. Snake_case JSON
 * in a Postgres row; string ids because JSON cannot carry bigint. A queued job
 * outlives the release that wrote it, so the shape changes additively: a new
 * field arrives optional and the reader takes it absent; making it required,
 * or dropping one, waits a release.
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
