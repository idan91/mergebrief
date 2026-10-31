import type { LockfileSides, LockfileSummary } from "brief-core/shortened";
import type { ValueOf } from "types/utils";

/** What the worker hands one lockfile child process. */
export interface SummaryRequest {
  path: string;
  sides: LockfileSides;
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
