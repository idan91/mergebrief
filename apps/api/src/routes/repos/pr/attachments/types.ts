import {
  AttachmentMediaTypes,
  type AssetAttachmentSource,
  type AttachmentAssetId,
  type AttachmentFile,
  type AttachmentSourceKinds,
} from "contract";
import type { QualifiedRefNamespace } from "brief-core/media-address";
import type {
  GitHubCallFailure,
  RenderedMediaSources,
  RepoReader,
} from "github";
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
  /** `MERGEBRIEF_MEDIA_MAX_MB` in bytes; omitted = the default. */
  readonly mediaMaxBytes?: number | undefined;
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
  /** Which bytes of the file the stream holds; absent when upstream named no size. */
  readonly extent?: ByteExtent;
}

/** How a bytes fetch reaches upstream. */
export interface UpstreamBytesRequest {
  /** The client's request signal: a disconnect cancels the upstream. */
  readonly signal: AbortSignal;
  /** The `bytes=` range to ask for; absent asks for the whole file. */
  readonly range?: string;
}

/** What the client asked of a media read, as the route parsed it. */
export interface BytesReadOptions {
  readonly signal: AbortSignal;
  /** The `bytes=` range one piece asks upstream for. */
  readonly upstreamRange: string;
  /** Whether the client sent a `Range`; without one only a video is read in pieces. */
  readonly rangeRequested: boolean;
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
  readonly bytes: BytesReadOptions;
}

/** A GitHub asset, looked up in the sources its pull request renders. */
export interface AssetReadInput {
  readonly prNumber: number;
  readonly assetId: AttachmentAssetId;
  readonly bytes: BytesReadOptions;
}

/** A file on the gated repo's attachments branch, named by the proxy path. */
export interface ReadBranchAttachmentInput {
  readonly owner: string;
  readonly repo: string;
  readonly file: AttachmentFile;
}

/** The image and video sources GitHub rendered for a PR, and when they were read. */
export interface RenderedSources {
  readonly sources: RenderedMediaSources;
  readonly fetchedAt: number;
  /** Read past a young entry for a page's missing video id; a later miss is answered from it until it ages. */
  readonly readForMissingAsset: boolean;
}

/** The rendered sources per viewer and PR, and the GitHub call running for each. */
export interface RenderedSourcesStore {
  /** key `${sessionHash}:${repoId}:${prNumber}` → the PR's rendered image and video sources. */
  readonly cache: TtlCache<RenderedSources>;
  /** The same key → the GitHub call already running for it. */
  readonly inFlight: Map<
    string,
    Promise<Result<RenderedSources, ReadAttachmentWireFailure>>
  >;
}

/** A pull request's rendered sources, the key they cache under and the reader that reads them. */
export interface RenderedSourcesRequest {
  readonly cacheKey: string;
  readonly reader: RepoReader;
  readonly prNumber: number;
}

/** One asset looked up in a pull request's rendered sources. */
export interface RenderedSourceRequest extends RenderedSourcesRequest {
  readonly assetId: AttachmentAssetId;
}

export interface ListVideoAssetsDeps {
  readonly sources: RenderedSourcesStore;
}

export interface ListVideoAssetsInput {
  readonly prNumber: number;
  /** A bare asset line's id the page's last answer lacked: it may have been posted since. */
  readonly missingAssetId?: AttachmentAssetId | undefined;
}

export interface ReadAttachmentDeps {
  readonly sources: RenderedSourcesStore;
  /** The bytes fetch, outside every binding. */
  readonly fetch: typeof fetch;
}

export const ReadAttachmentFailureKinds = {
  GITHUB_DENIED: FailureKinds.GITHUB_DENIED,
  ASSET_ABSENT: "asset-absent",
  RANGE_NOT_SATISFIABLE: "range-not-satisfiable",
} as const;

/** A failure the wire answers through an `ApiError`. */
export type ReadAttachmentWireFailure =
  | { readonly kind: typeof ReadAttachmentFailureKinds.ASSET_ABSENT }
  | {
      readonly kind: typeof ReadAttachmentFailureKinds.GITHUB_DENIED;
      readonly error: GitHubCallFailure;
    };

/**
 * GitHub's refusal of the sources or the bytes, an asset the PR does not
 * render, or a range starting past the file's end, which upstream refused.
 */
export type ReadAttachmentFailure =
  | ReadAttachmentWireFailure
  | { readonly kind: typeof ReadAttachmentFailureKinds.RANGE_NOT_SATISFIABLE };

export interface UploadAttachmentInput {
  readonly file: AttachmentFile;
  readonly bytes: Uint8Array;
}

/** The fresh re-resolve's refusal, then the push's, wrapped whole. */
export type UploadAttachmentFailure = GitHubDeniedFailure<GitHubCallFailure>;

/** What a video may be served as, pasted or committed. */
export const VideoMediaTypes = {
  MP4: "video/mp4",
  WEBM: "video/webm",
  QUICKTIME: "video/quicktime",
} as const;
export type VideoMediaType = ValueOf<typeof VideoMediaTypes>;

/** What a pasted asset may be served as: the attachment rasters and the videos. */
export const AssetMediaTypes = {
  ...AttachmentMediaTypes,
  ...VideoMediaTypes,
} as const;
export type AssetMediaType = ValueOf<typeof AssetMediaTypes>;

/**
 * What a committed file in the pull request's own repository may be served
 * as: the attachment rasters, the videos, and SVG, which only a committed
 * file may be.
 */
export const CommittedFileMediaTypes = {
  ...AssetMediaTypes,
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
  /** This read's client: once it leaves, this read stops waiting; the shared lookup runs on. */
  readonly signal: AbortSignal;
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
  readonly bytes: BytesReadOptions;
}

/** A file in the gated repository at a resolved ref. */
export interface CommittedFileRequest extends CommittedFileLocation {
  readonly owner: string;
  readonly repo: string;
}

export const ByteRangeKinds = {
  FROM: "from",
  SUFFIX: "suffix",
} as const;

/** One `bytes=` range as the client wrote it: from a byte on, or the last `length` bytes. */
export type RequestedRange =
  | {
      readonly kind: typeof ByteRangeKinds.FROM;
      readonly first: number;
      readonly last?: number;
    }
  | { readonly kind: typeof ByteRangeKinds.SUFFIX; readonly length: number };

/** A requested range closed and shortened to one piece. */
export type WantedRange =
  | {
      readonly kind: typeof ByteRangeKinds.FROM;
      readonly first: number;
      readonly last: number;
    }
  | { readonly kind: typeof ByteRangeKinds.SUFFIX; readonly length: number };

/** Which bytes of the file an upstream answer holds, inclusive, and the file's size. */
export interface ByteExtent {
  readonly first: number;
  readonly last: number;
  readonly total: number;
}

/** The bytes one reply serves, and where they sit inside the upstream answer. */
export interface ServedSlice extends ByteExtent {
  readonly skip: number;
  readonly length: number;
}

export const SliceRefusalKinds = {
  UNSATISFIABLE: "unsatisfiable",
  NOT_COVERED: "not-covered",
} as const;

/** The wanted start lies past the file's end, or upstream answered other bytes than asked. */
export type SliceRefusal =
  | {
      readonly kind: typeof SliceRefusalKinds.UNSATISFIABLE;
      readonly total: number;
    }
  | { readonly kind: typeof SliceRefusalKinds.NOT_COVERED };

/** One open media stream's place in the per-process count; releasing twice frees it once. */
export interface StreamPermit {
  release(): void;
}

/** The per-process count of open media streams, refused past its limit. */
export interface StreamPermits {
  acquire(): StreamPermit | undefined;
  countOpen(): number;
}

/** The request a slice serves and the callback that releases what it holds. */
export interface SliceStreamOptions {
  /** The client's request signal: once it aborts the slice ends. */
  readonly signal: AbortSignal;
  readonly onSettled: () => void;
  /** How long the slice may stream from its creation before it ends. */
  readonly deadlineMs: number;
}

/** Where a reply's bytes start inside its upstream stream, and how many it serves. */
export interface StreamWindow {
  readonly skip: number;
  /** Absent: every byte to the end of the source, as a whole-file reply serves. */
  readonly length?: number;
}

export const MediaReplyRefusalKinds = {
  ...SliceRefusalKinds,
  TOO_LARGE: "too-large",
  SIZE_UNKNOWN: "size-unknown",
} as const;

/** Why a piece cannot be served: past the cap, of no known size, or a slice refusal. */
export type MediaReplyRefusal =
  | SliceRefusal
  | { readonly kind: typeof MediaReplyRefusalKinds.TOO_LARGE }
  | { readonly kind: typeof MediaReplyRefusalKinds.SIZE_UNKNOWN };

/** Why a whole-image reply cannot be served: it declares a size past the cap. */
export type WholeReplyRefusal = Extract<
  MediaReplyRefusal,
  { readonly kind: typeof MediaReplyRefusalKinds.TOO_LARGE }
>;
export const ResizeImageFailureKinds = {
  /** The bytes are not PNG, JPEG, WebP or GIF, whatever upstream named them. */
  NOT_A_RASTER: "not-a-raster",
  /** The header declares more pixels than a thumbnail decodes. */
  TOO_MANY_PIXELS: "too-many-pixels",
  /** sharp refused them: corrupt, or past its time limit. */
  UNDECODABLE: "undecodable",
} as const;

export type ResizeImageFailure =
  | { readonly kind: typeof ResizeImageFailureKinds.NOT_A_RASTER }
  | { readonly kind: typeof ResizeImageFailureKinds.TOO_MANY_PIXELS }
  | {
      readonly kind: typeof ResizeImageFailureKinds.UNDECODABLE;
      readonly reason: string;
    };

export const ThumbnailFailureKinds = {
  ...ResizeImageFailureKinds,
  /** The original passes the thumbnail bound, as named or as read. */
  TOO_LARGE: "too-large",
  /** No resize turn freed inside the wait. */
  BUSY: "busy",
  /** The original's body failed or was cut off mid-read. */
  UNREADABLE: "unreadable",
} as const;

/** Why a strip thumbnail could not be made; only `busy` answers other than a failed read. */
export type ThumbnailFailure =
  | ResizeImageFailure
  | {
      readonly kind:
        | typeof ThumbnailFailureKinds.TOO_LARGE
        | typeof ThumbnailFailureKinds.BUSY
        | typeof ThumbnailFailureKinds.UNREADABLE;
    };

/** One running resize's place in the per-process count; releasing twice frees it once. */
export interface ResizeTurn {
  release(): void;
}

/** The per-process count of running resizes; past its limit a request waits its turn, then gives up. */
export interface ResizeTurns {
  /** Undefined when no turn came inside the wait, the queue was full, or the request was aborted first. */
  waitForTurn(signal: AbortSignal): Promise<ResizeTurn | undefined>;
  countRunning(): number;
  countWaiting(): number;
}

/** The per-process media limits both reads share. */
export interface MediaStreamBudget {
  /** `MERGEBRIEF_MEDIA_MAX_MB` in bytes, judged on the upstream file's total. */
  readonly maxFileBytes: number;
  readonly permits: StreamPermits;
  readonly resizeTurns: ResizeTurns;
}
