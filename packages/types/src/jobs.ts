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
