import type { Context } from "hono";
import type { AttachmentAssetId } from "contract";
import type { GitHubApiError } from "github";
import {
  FailureKinds,
  type TokenUnreadableFailure,
} from "../../../../shared-errors/failures";
import type { ReviewerGitHubClient } from "../../../auth/reviewer-github-client";
import type { AuthzEnv } from "../../../authz";
import type { Result } from "types/utils";
import type { TtlCache } from "../../../ttl-cache";

/** The asset's bytes as GitHub streams them, with the type it declared. */
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
}

export const ReadAttachmentFailureKinds = {
  TOKEN_UNREADABLE: FailureKinds.TOKEN_UNREADABLE,
  GITHUB_DENIED: FailureKinds.GITHUB_DENIED,
  ASSET_ABSENT: "asset-absent",
} as const;

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
