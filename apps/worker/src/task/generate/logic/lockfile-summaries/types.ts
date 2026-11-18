import type { LockfileSides, LockfileSummary } from "brief-core/shortened";
import type { SpanBaseRefs } from "persistence";
import type { ValueOf } from "types/utils";

/** What the worker hands one lockfile child process; `mergeBases` when the two heads sit on different ones. */
export interface SummaryRequest {
  path: string;
  sides: LockfileSides;
  mergeBases?: LockfileSides;
}

/** What a lockfile child posts back once; no summary for a path that is no lockfile. */
export interface SummaryReply {
  summary?: LockfileSummary;
}

/** What every lockfile child of one span shares: when it must end, and what stops it. */
export interface SpanLimits {
  deadline: number;
  stop: AbortSignal;
}

/** What one lockfile child may spend before it is killed. */
export interface ChildLimits {
  timeoutMs: number;
  stop: AbortSignal;
}

/** Why a lockfile child gave no summary; each reads the lockfile as unparseable. */
export const SummaryFailures = {
  TIMED_OUT: "timed-out",
  /** The child exited first: out of heap, or a request it could not read. */
  CRASHED: "crashed",
  MALFORMED_REPLY: "malformed-reply",
  /** The run stopped: superseded, its claim lost, or the worker shutting down. */
  STOPPED: "stopped",
} as const;
export type SummaryFailure = ValueOf<typeof SummaryFailures>;

export const LockfileSpanKinds = {
  /** The whole PR: the base side is read at the merge base, as the PR diff is taken from it. */
  PULL_REQUEST: "pull-request",
  /** A revision span: each head's own change against its own merge base, so a rebase's base bumps stay out. */
  REVISION: "revision",
} as const;

/** The whole PR's commits: `base` is the PR's base branch head. */
export interface PullRequestLockfileSpan {
  readonly kind: typeof LockfileSpanKinds.PULL_REQUEST;
  readonly base: string;
  readonly head: string;
}

/** A revision span from the `base` head to the `head` one; `refs` are the bases each was read against. */
export interface RevisionLockfileSpan {
  readonly kind: typeof LockfileSpanKinds.REVISION;
  readonly base: string;
  readonly head: string;
  readonly refs: SpanBaseRefs;
}

export type LockfileSpan = PullRequestLockfileSpan | RevisionLockfileSpan;
