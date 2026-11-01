import {
  AttachmentMediaTypes,
  type AssetAttachmentSource,
  type AttachmentAssetId,
  type AttachmentFile,
  type AttachmentSourceKinds,
} from "contract";
import type { QualifiedRefNamespace } from "brief-core/media-address";
import type { GitHubCallFailure, RepoReader } from "github";
import type { InstallationBindingDeps } from "../../../../access/types";
import {
  FailureKinds,
  type GitHubDeniedFailure,
} from "../../../../shared-errors/failures";
import type { AuthRouteDeps } from "../../../auth/session/types";
import type { Result, ValueOf } from "types/utils";
import type { TtlCache } from "../../../ttl-cache";

/** The read binds the viewer's GitHub; the upload also binds the App's. */
export interface AttachmentsRouteDeps
  extends AuthRouteDeps, InstallationBindingDeps {
  /** Omitted = the default limits. */
  readonly attachmentQuota?: UploadQuotaLimits;
  /** Omitted = `DEFAULT_COMMITTED_LOOKUP_LIMITS`. */
  readonly committedLookupBudget?: CommittedLookupBudgetLimits;
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

/** The fresh re-resolve's refusal, then the push's, wrapped whole. */
export type UploadAttachmentFailure = GitHubDeniedFailure<GitHubCallFailure>;

/**
 * What a committed file in the pull request's own repository may be served
 * as: the attachment rasters, and SVG, which only a committed file may be.
 */
export const CommittedFileMediaTypes = {
  ...AttachmentMediaTypes,
  SVG: "image/svg+xml",
} as const;
export type CommittedFileMediaType = ValueOf<typeof CommittedFileMediaTypes>;

/** A committed file's address split where its ref ends. */
export interface CommittedFileLocation {
  readonly ref: string;
  readonly fileSegments: readonly string[];
}

type RefNamesResult = Result<readonly string[], ReadAttachmentFailure>;

/** What matching-refs is asked: the names starting with the ref's first segment, in these namespaces. */
export interface CommittedRefQuery {
  readonly prefix: string;
  readonly namespaces: readonly QualifiedRefNamespace[];
}

/** The ref names matching a first path segment, per viewer and repository. */
export interface CommittedRefsStore {
  /** key `${sessionHash}:${repoId}:${refs/<namespace>/ when qualified}${prefix}` → the matching names. */
  readonly cache: TtlCache<readonly string[]>;
  /** The same key → the GitHub call already running for it. */
  readonly inFlight: Map<string, Promise<RefNamesResult>>;
}

/** `${sessionHash}:${repoId}`: one viewer in one repository, which every cached committed-file lookup is keyed under. */
export type CommittedViewerKey = `${string}:${string}`;
/** A viewer key, then what the cached lookup names (a ref prefix, or a file's ref and path). */
export type CommittedLookupKey = `${CommittedViewerKey}:${string}`;

/** One committed address to split, and how to ask GitHub for its refs. */
export interface CommittedRefRequest {
  readonly viewerKey: CommittedViewerKey;
  readonly pathSegments: readonly string[];
  readonly listRefs: (query: CommittedRefQuery) => Promise<RefNamesResult>;
}

/** How many GitHub calls one viewer's committed-file reads may make inside one window. */
export interface CommittedLookupBudgetLimits {
  readonly maxLookups: number;
  readonly windowMs: number;
}

/** One viewer's GitHub calls since `startedAt` (epoch ms). */
export interface CommittedLookupWindow {
  readonly startedAt: number;
  readonly lookups: number;
}

/** The limits and the per-process table, keyed by reviewer id. */
export interface CommittedLookupBudget {
  readonly limits: CommittedLookupBudgetLimits;
  readonly windows: TtlCache<CommittedLookupWindow>;
}

export type CommittedLookupSpend = Result<CommittedLookupWindow, undefined>;

export interface CommittedFileStore {
  readonly refs: CommittedRefsStore;
  readonly lookupBudget: CommittedLookupBudget;
  /** key `${sessionHash}:${repoId}:${JSON of ref and path segments}` → the file's `download_url`. */
  readonly downloadUrls: TtlCache<string>;
}

export interface ReadCommittedFileDeps {
  readonly store: CommittedFileStore;
  /** Every GitHub request the read makes, outside every binding. */
  readonly fetch: typeof fetch;
}

export interface ReadCommittedFileInput {
  /** The ref then the path, decoded, as the parsed address names them. */
  readonly pathSegments: readonly string[];
}

/** A file in the gated repository at a resolved ref. */
export interface CommittedFileRequest extends CommittedFileLocation {
  readonly owner: string;
  readonly repo: string;
}
