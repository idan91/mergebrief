import type {
  AssetAttachmentSource,
  AttachmentAssetId,
  AttachmentFile,
  AttachmentSourceKinds,
} from "contract";
import type { GitHubCallFailure, RepoReader } from "github";
import type { InstallationBindingDeps } from "../../../../access/types";
import {
  FailureKinds,
  type GitHubDeniedFailure,
} from "../../../../shared-errors/failures";
import type { AuthRouteDeps } from "../../../auth/session/types";
import type { Result } from "types/utils";
import type { TtlCache } from "../../../ttl-cache";

/** The read binds the viewer's GitHub; the upload also binds the App's. */
export interface AttachmentsRouteDeps
  extends AuthRouteDeps, InstallationBindingDeps {
  /** Omitted = the default limits. */
  readonly attachmentQuota?: UploadQuotaLimits;
}

/** What one reviewer may upload inside one window. */
export interface UploadQuotaLimits {
  readonly maxFiles: number;
  readonly maxBytes: number;
  readonly windowMs: number;
}

/** One reviewer's charged uploads since `startedAt` (epoch ms). */
export interface UploadWindow {
  readonly startedAt: number;
  readonly files: number;
  readonly bytes: number;
}

/** The limits and the per-process table, keyed by reviewer id. */
export interface UploadQuota {
  readonly limits: UploadQuotaLimits;
  readonly windows: TtlCache<UploadWindow>;
}

export interface UploadQuotaRefusal {
  /** Whole seconds until the reviewer's window ends. */
  readonly retryAfterSeconds: number;
}

export type UploadReservation = Result<UploadWindow, UploadQuotaRefusal>;

/** The bytes as GitHub streams them, with the type the proxy serves them under. */
export interface AttachmentBytes {
  readonly body: ReadableStream<Uint8Array>;
  readonly contentType: string;
}

/** What the `:assetId` param names: a GitHub asset, or a file on the attachments branch. */
export type AttachmentTarget =
  | AssetAttachmentSource
  | {
      readonly kind: typeof AttachmentSourceKinds.BRANCH;
      readonly file: AttachmentFile;
    };

export interface ReadAttachmentInput {
  readonly prNumber: number;
  readonly target: AttachmentTarget;
}

/** A GitHub asset, looked up in the sources its pull request renders. */
export interface AssetReadInput {
  readonly prNumber: number;
  readonly assetId: AttachmentAssetId;
}

/** A file on the gated repo's attachments branch, named by the proxy path. */
export interface ReadBranchAttachmentInput {
  readonly owner: string;
  readonly repo: string;
  readonly file: AttachmentFile;
}

/** The image sources GitHub rendered for a PR, and when they were read. */
export interface RenderedSources {
  readonly sources: readonly string[];
  readonly fetchedAt: number;
}

/** The rendered sources per viewer and PR, and the GitHub call running for each. */
export interface RenderedSourcesStore {
  /** key `${sessionHash}:${repoId}:${prNumber}` → the PR's rendered image sources. */
  readonly cache: TtlCache<RenderedSources>;
  /** The same key → the GitHub call already running for it. */
  readonly inFlight: Map<
    string,
    Promise<Result<RenderedSources, ReadAttachmentFailure>>
  >;
}

/** One asset looked up in a pull request's rendered sources. */
export interface RenderedSourceRequest {
  readonly cacheKey: string;
  readonly reader: RepoReader;
  readonly prNumber: number;
  readonly assetId: AttachmentAssetId;
}

export interface ReadAttachmentDeps {
  readonly sources: RenderedSourcesStore;
  /** The bytes fetch, outside every binding. */
  readonly fetch: typeof fetch;
}

export const ReadAttachmentFailureKinds = {
  GITHUB_DENIED: FailureKinds.GITHUB_DENIED,
  ASSET_ABSENT: "asset-absent",
} as const;

/** GitHub's refusal of the sources or the bytes, or an asset the PR does not render. */
export type ReadAttachmentFailure =
  | { readonly kind: typeof ReadAttachmentFailureKinds.ASSET_ABSENT }
  | {
      readonly kind: typeof ReadAttachmentFailureKinds.GITHUB_DENIED;
      readonly error: GitHubCallFailure;
    };

export interface UploadAttachmentInput {
  readonly file: AttachmentFile;
  readonly bytes: Uint8Array;
}

export interface UploadedAttachment {
  /** The branch URL a comment carries; GitHub renders it inline. */
  readonly url: string;
}

/** The fresh re-resolve's refusal, then the push's, wrapped whole. */
export type UploadAttachmentFailure = GitHubDeniedFailure<GitHubCallFailure>;
