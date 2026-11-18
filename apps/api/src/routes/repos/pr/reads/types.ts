import type { PrSpanRefs, PrSpanRunner } from "brief-core/pr-span";
import type { DiffMode } from "contract";
import type { OpenPullRequest } from "brief-core/pr-stack";
import type { GitHubCallFailure } from "github";
import type { Logger } from "logging";
import type { AppDatabase, SpanBaseRefs } from "persistence";
import type { DraftPolicy, Result, ValueOf } from "types";
import type { PullRequestAccess } from "../../../../access/types";
import type { FailureKinds } from "../../../../shared-errors/failures";
import type { LiveFactsReader } from "../../../live-read/types";
import type { AuthRouteDeps } from "../../../auth/session/types";

/** The reads leaf's deps: the process logger serves state no request owns, the span thread. */
export interface ReadsRouteDeps extends AuthRouteDeps {
  readonly logger: Logger;
}
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
  /** `bytes` is what V8 holds for `diff`; past `maxEntryBytes` nothing is
   * stored and it answers false. */
  set(
    key: string,
    diff: string,
    bytes: number,
    now: number,
    lifetime: DiffLifetime,
  ): boolean;
}

/** The bounds on the cache for diffs past the small cache's entry cap. */
export interface LargeDiffCacheLimits {
  readonly maxEntryBytes: number;
  /** Instance-wide, over every viewer's entries. */
  readonly maxBytes: number;
  readonly maxEntries: number;
  readonly maxEntriesPerViewer: number;
  readonly shaPinnedTtlMs: number;
}

/** Large diff bodies of spans pinned to two commit SHAs, a few per viewer
 * under one instance-wide byte cap. */
export interface LargeDiffCache {
  get(key: string, now: number): string | undefined;
  /** `bytes` is what V8 holds for `diff`; nothing is stored past `maxEntryBytes`. */
  set(
    viewer: string,
    key: string,
    diff: string,
    bytes: number,
    now: number,
  ): void;
}

export interface ReadDiffDeps {
  readonly diffCache: SpanDiffCache;
  /** Diffs past the small cache's entry cap, under the same keys. */
  readonly largeDiffCache: LargeDiffCache;
  /** The GitHub call each cache key is waiting on, removed once it settles. */
  readonly diffFetches: Map<string, Promise<DiffRead>>;
  /** How a pair is served, from the PR's stored rows. */
  readonly spanKeys: SpanKeyReader;
  /** The span's steps that grow with the PR diffs and blobs, off the event loop. */
  readonly spanRunner: PrSpanRunner;
}

/** Reads the PR's Brief pairs and the pair's span key; a database error rejects. */
export interface SpanKeyReader {
  classify(access: PullRequestAccess, pair: SpanPair): Promise<SpanRead>;
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

/** A span past the line and file bounds, or one the worker stored as refused. */
export interface SpanTooLargeFailure {
  readonly kind: "span-too-large";
}

/** The read's deadline passed, or the span thread stopped, before the span was read. */
export interface DiffDeadlineFailure {
  readonly kind: "deadline";
}

/** Result-side failures of the live diff proxy; the adapter owns posture. */
export type DiffFailure =
  | RepoNameFailure
  | GitHubReadFailure
  | SpanTooLargeFailure
  | DiffDeadlineFailure;

export type DiffRead = Result<string, DiffFailure>;

/** A diff read and the read it served, which rides the answer's mode header. */
export interface ModedDiffRead {
  readonly mode: DiffMode;
  readonly read: DiffRead;
}

/** Result-side failures of the live stack read: the diff proxy's GitHub two. */
export type StackFailure = RepoNameFailure | GitHubReadFailure;

/** Result-side failures of the file-range read; the adapter owns posture. */
export type FileRangeFailure =
  | RepoNameFailure
  | GitHubReadFailure
  | { readonly kind: "file-absent" }
  | { readonly kind: "file-too-large" }
  | { readonly kind: "file-not-text" };

/** How a diff read is served for a `base...head` pair. */
export const SpanReadKinds = {
  /** GitHub's `base...head` compare: a whole-PR read, or a pair no span key covers. */
  COMPARE: "compare",
  /** The revision span the key's marks row certifies, on the refs that row stores. */
  SPAN: "span",
  /** The worker stored the span as refused: no marks, a skip record. */
  REFUSED: "refused",
} as const;

export interface SpanPair {
  readonly base: string;
  readonly head: string;
}

export type SpanRead =
  | { readonly kind: typeof SpanReadKinds.COMPARE }
  | { readonly kind: typeof SpanReadKinds.SPAN; readonly refs: PrSpanRefs }
  | { readonly kind: typeof SpanReadKinds.REFUSED };

/** What the worker stored under one span key. */
export interface SpanKeyFacts {
  /** The bases the key's marks row was written from; absent with no row. */
  readonly marksRefs?: SpanBaseRefs;
  /** A narrative or delta skipped under the key as too large to read. */
  readonly isRefused: boolean;
}
