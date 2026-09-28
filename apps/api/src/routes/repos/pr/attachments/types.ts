import type { Context } from "hono";
import type {
  AssetAttachmentSource,
  AttachmentAssetId,
  AttachmentFile,
  AttachmentMediaType,
  AttachmentSourceKinds,
} from "contract";
import type { GitHubApiError } from "github";
import type { InstallationId, RepoId } from "persistence";
import {
  FailureKinds,
  type GitHubDeniedFailure,
  type TokenUnreadableFailure,
} from "../../../../shared-errors/failures";
import type { ReviewerGitHubClient } from "../../../auth/reviewer-github-client";
import type { AuthRouteDeps } from "../../../auth/session/types";
import type { AuthzEnv } from "../../../authz";
import type { InstallationGitHubPort } from "../../../github-port";
import type { Result } from "types/utils";
import type { TtlCache } from "../../../ttl-cache";
import type { RepoResolveFailure } from "../logic/resolve-repo-owner-and-name";

/** The read side needs the viewer's token; the upload also needs the App's. */
export interface AttachmentsRouteDeps extends AuthRouteDeps {
  readonly github: InstallationGitHubPort;
}

/** The bytes as GitHub streams them, with the type the proxy serves them under. */
export interface AttachmentBytes {
  readonly body: ReadableStream<Uint8Array>;
  readonly contentType: string;
}

export interface ReadAttachmentInput {
  readonly assetId: AttachmentAssetId;
  readonly owner: string;
  readonly repo: string;
  readonly prNumber: number;
  readonly sessionTokenHash: string;
}

/** What the `:assetId` param names: a GitHub asset, or a file on the attachments branch. */
export type AttachmentTarget =
  | AssetAttachmentSource
  | {
      readonly kind: typeof AttachmentSourceKinds.BRANCH;
      readonly file: AttachmentFile;
    };

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

/** The per-request reviewer channel, the fetch the step runs on, the sources cache. */
export interface AttachmentsControllerDeps {
  readonly github: ReviewerGitHubClient;
  readonly fetchImpl: typeof fetch;
  /** key `${sessionHash}:${repoId}:${prNumber}` → the PR's rendered image sources. */
  readonly sourcesCache: TtlCache<RenderedSources>;
  /** The same key → the GitHub call already running for it. */
  readonly sourcesInFlight: Map<
    string,
    Promise<Result<RenderedSources, ReadAttachmentFailure>>
  >;
  readonly repoId: string;
}

/** The domain's handlers, the shape the route factory mounts. */
export interface AttachmentsHandlers {
  readonly readAttachment: (c: Context<AuthzEnv>) => Promise<Response>;
  readonly uploadAttachment: (c: Context<AuthzEnv>) => Promise<Response>;
}

export const ReadAttachmentFailureKinds = {
  TOKEN_UNREADABLE: FailureKinds.TOKEN_UNREADABLE,
  GITHUB_DENIED: FailureKinds.GITHUB_DENIED,
  ASSET_ABSENT: "asset-absent",
} as const;

/** The per-request reviewer channel for the fresh re-resolve, and the App's port for the push. */
export interface UploadControllerDeps {
  readonly reviewer: ReviewerGitHubClient;
  readonly port: InstallationGitHubPort;
}

export interface UploadAttachmentInput {
  readonly installationId: InstallationId;
  readonly repoId: RepoId;
  readonly file: AttachmentFile;
  readonly mediaType: AttachmentMediaType;
  readonly bytes: Uint8Array;
}

export interface UploadedAttachment {
  /** The branch URL a comment carries; GitHub renders it inline. */
  readonly url: string;
}

/** The fresh re-resolve's failures, then the push's, wrapped whole. */
export type UploadAttachmentFailure =
  | RepoResolveFailure
  | GitHubDeniedFailure<GitHubApiError>;

/** Result-side failures of the proxy read; the diff proxy's two plus an absent asset. */
export type ReadAttachmentFailure =
  | TokenUnreadableFailure
  | { readonly kind: typeof ReadAttachmentFailureKinds.ASSET_ABSENT }
  | {
      readonly kind: typeof ReadAttachmentFailureKinds.GITHUB_DENIED;
      readonly error: GitHubApiError;
      /** True when the failure survived a post-refresh retry. */
      readonly retried: boolean;
    };
