import type { ValueOf } from "./utils";

/** The graphile task ids persistence enqueues and the worker registers. */
export const QueueTasks = {
  GENERATE: "generate",
  RECOVER_GENERATION: "recover-generation",
  /** The large pool's `generate`: a run the PR read predicts multi-call. */
  GENERATE_LARGE: "generate-large",
  /** The large pool's `recover-generation`, routed by the same prediction. */
  RECOVER_GENERATION_LARGE: "recover-generation-large",
  /** Renders a head's Entry comment from its generation row; the generate payload. */
  SYNC_ENTRY: "sync-entry",
} as const;
export type QueueTask = ValueOf<typeof QueueTasks>;

/**
 * The enqueue's W3C `traceparent`, written only inside a sampled trace. The
 * worker links its job span to it; nothing else may read it.
 */
export interface JobTraceContext {
  readonly traceparent?: string;
}

/**
 * Enqueue-to-drain handshake between persistence and worker. Snake_case JSON
 * in a Postgres row; string ids because JSON cannot carry bigint. A queued job
 * outlives the release that wrote it, so the shape changes additively: a new
 * field arrives optional and the reader takes it absent; making it required,
 * or dropping one, waits a release.
 */
export interface InstallationGenerateJobPayload extends JobTraceContext {
  readonly installation_id: string;
  readonly pull_request_id: string;
  readonly head_sha: string;
}

export interface UrlBoxGenerateJobPayload extends JobTraceContext {
  readonly owner_user_id: string;
  readonly grant_id: string;
  readonly pull_request_id: string;
  readonly head_sha: string;
}

export type GenerateJobPayload =
  | InstallationGenerateJobPayload
  | UrlBoxGenerateJobPayload;
