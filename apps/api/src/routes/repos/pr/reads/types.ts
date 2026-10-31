import type { OpenPullRequest } from "brief-core/pr-stack";
import type { GitHubCallFailure } from "github";
import type { Logger } from "logging";
import type { AppDatabase } from "persistence";
import type { DraftPolicy, Result, ValueOf } from "types";
import type { FailureKinds } from "../../../../shared-errors/failures";
import type { LiveFactsReader } from "../../../live-read/types";
import type { TtlCache } from "../../../ttl-cache";

/** The span names no artifact stored on the access step's row. */
export interface ArtifactNotFoundFailure {
  readonly kind: "not-found";
}

/** A stored body, verbatim: it is already JSON. */
export type ReadArtifactResult = Result<string, ArtifactNotFoundFailure>;

export interface ReadPullDeps {
  readonly handle: AppDatabase;
  readonly draftPolicy: DraftPolicy;
  /** Present only behind an operator pass, for what the viewer could not see. */
  readonly operator?: LiveFactsReader | undefined;
  readonly log: Logger;
}

/** A diff body with the bytes V8 holds for it, measured once at write. */
export interface SizedDiff {
  readonly diff: string;
  readonly bytes: number;
}

/** How long a span's diff can be trusted: a span between two full SHAs never changes. */
export const DiffLifetimes = {
  LIVE: "live",
  SHA_PINNED: "sha-pinned",
} as const;
export type DiffLifetime = ValueOf<typeof DiffLifetimes>;

/** The bounds on the per-session cache for span diffs under its entry cap. */
export interface SpanDiffCacheLimits {
  readonly maxEntryBytes: number;
  /** Instance-wide, over every session's entries. */
  readonly maxBytes: number;
  readonly maxEntries: number;
  readonly ttlMs: number;
  readonly shaPinnedTtlMs: number;
}

/** Span diff bodies keyed per session, repo, PR and span. */
export interface SpanDiffCache {
  get(key: string, now: number): string | undefined;
  /** `bytes` is what V8 holds for `diff`; nothing is stored past `maxEntryBytes`. */
  set(
    key: string,
    diff: string,
    bytes: number,
    now: number,
    lifetime: DiffLifetime,
  ): void;
}

/** The bounds on the cache for diffs past the small cache's entry cap. */
export interface LargeDiffCacheLimits {
  readonly maxEntryBytes: number;
  /** Instance-wide, over every viewer's entries. */
  readonly maxBytes: number;
  readonly maxEntries: number;
  readonly maxEntriesPerViewer: number;
  readonly ttlMs: number;
  readonly shaPinnedTtlMs: number;
}

/** Large diff bodies, a few per viewer under one instance-wide byte cap. */
export interface LargeDiffCache {
  get(key: string, now: number): string | undefined;
  /** `bytes` is what V8 holds for `diff`; nothing is stored past `maxEntryBytes`. */
  set(
    viewer: string,
    key: string,
    diff: string,
    bytes: number,
    now: number,
    lifetime: DiffLifetime,
  ): void;
}

export interface ReadDiffDeps {
  readonly diffCache: SpanDiffCache;
  /** Diffs past the small cache's entry cap, under the same keys. */
  readonly largeDiffCache: LargeDiffCache;
  /** The GitHub call each cache key is waiting on, removed once it settles. */
  readonly diffFetches: Map<string, Promise<DiffRead>>;
}

export interface ReadFileRangeDeps {
  /** Split blobs keyed per session, repo, ref and path. */
  readonly fileCache: TtlCache<readonly string[]>;
}

export interface ReadStackDeps {
  readonly handle: AppDatabase;
  /** The repo's open PRs keyed per session and repo: one list per stack walk. */
  readonly openPullsCache: TtlCache<readonly OpenPullRequest[]>;
  readonly log: Logger;
}

/** The gate's verified slug would not split into owner and name. */
export interface RepoNameFailure {
  readonly kind: "not-found";
}

/** GitHub's refusal on the viewer's binding, riding whole. */
export interface GitHubReadFailure {
  readonly kind: typeof FailureKinds.GITHUB_DENIED;
  readonly error: GitHubCallFailure;
}

/** Result-side failures of the live diff proxy; the adapter owns posture. */
export type DiffFailure = RepoNameFailure | GitHubReadFailure;

export type DiffRead = Result<string, DiffFailure>;

/** Result-side failures of the live stack read; the same two the diff proxy has. */
export type StackFailure = DiffFailure;

/** Result-side failures of the file-range read; the adapter owns posture. */
export type FileRangeFailure =
  | DiffFailure
  | { readonly kind: "file-absent" }
  | { readonly kind: "file-too-large" }
  | { readonly kind: "file-not-text" };
