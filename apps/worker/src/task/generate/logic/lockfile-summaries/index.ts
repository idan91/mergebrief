import {
  DiffFileStatuses,
  listChangedLockfiles,
  type ChangedLockfile,
} from "brief-core";
import {
  detectLockfile,
  LOCKFILE_MAX_BYTES,
  LockfileReadFailures,
  LockfileSideKinds,
  summarizeUnreadLockfile,
  type LockfileSide,
  type LockfileSummary,
} from "brief-core/shortened";
import {
  GitHubApiErrorCodes,
  RepoFileKinds,
  type GitHubCallFailure,
} from "github";
import type { Logger } from "logging";
import type { Result } from "types/utils";
import type { PullRequestSource } from "../../../github-port";
import { isPermanentGitHubError, throwOnGitHubFailure } from "../errors";
import { summarizeInChild } from "./isolated-summary";
import {
  SummaryFailures,
  type SpanLimits,
  type SummaryFailure,
  type SummaryReply,
} from "./types";

type LockfileReads = Pick<
  PullRequestSource,
  "fetchRepoFileAt" | "fetchMergeBase"
>;

/** The commits a diff spans; the lockfile's base side is read where the diff starts, their merge base. */
export interface LockfileSpan {
  readonly base: string;
  readonly head: string;
}

/** Lockfiles read per span; one past it has no summary, so it fires. */
const MAX_LOCKFILES_READ = 20;
/** Wall-clock time every lockfile child of one span shares; a lockfile past it reads as unparseable. */
const SPAN_BUDGET_MS = 60_000;

/** Content GitHub will never serve as lockfile text: a symlink, directory or submodule, or bytes that are not UTF-8. */
const LOCKFILE_REFUSALS: ReadonlySet<string> = new Set([
  GitHubApiErrorCodes.NOT_A_BLOB,
  GitHubApiErrorCodes.NOT_TEXT,
]);

/** A lockfile past the span budget reads as timed out, with no child forked. */
const BUDGET_SPENT: Result<SummaryReply, SummaryFailure> = {
  ok: false,
  error: SummaryFailures.TIMED_OUT,
};

const ABSENT_SIDE: LockfileSide = { kind: LockfileSideKinds.ABSENT };
const UNAVAILABLE_SIDE: LockfileSide = { kind: LockfileSideKinds.UNAVAILABLE };

function isRefusedForGood(error: GitHubCallFailure): boolean {
  return isPermanentGitHubError(error) || LOCKFILE_REFUSALS.has(error.code);
}

/**
 * A side the diff says exists. Content GitHub refuses for good (a missing
 * file, a non-file, one over the cap) reads unavailable, which fails
 * closed; a failure a retry may clear throws for graphile's retry.
 */
async function readSide(
  source: LockfileReads,
  path: string,
  ref: string,
  log: Logger,
): Promise<LockfileSide> {
  const read = await source.fetchRepoFileAt(path, ref, LOCKFILE_MAX_BYTES);
  if (!read.ok && !isRefusedForGood(read.error)) {
    throwOnGitHubFailure(read);
  }
  if (!read.ok) {
    log.warn("generate: lockfile read failed", {
      path,
      ref,
      code: read.error.code,
    });
    return UNAVAILABLE_SIDE;
  }
  if (read.value.kind !== RepoFileKinds.FILE) {
    log.info("generate: lockfile not read", {
      path,
      ref,
      kind: read.value.kind,
    });
    return UNAVAILABLE_SIDE;
  }
  return { kind: LockfileSideKinds.TEXT, text: read.value.content };
}

/** The commit the diff is taken from; a permanent refusal leaves no base to read. */
async function readMergeBase(
  source: LockfileReads,
  span: LockfileSpan,
  log: Logger,
): Promise<string | undefined> {
  const read = await source.fetchMergeBase(span.base, span.head);
  if (!read.ok && !isPermanentGitHubError(read.error)) {
    throwOnGitHubFailure(read);
  }
  if (!read.ok) {
    log.warn("generate: lockfile merge base not read", {
      code: read.error.code,
    });
    return undefined;
  }
  return read.value;
}

/**
 * Where the lockfile's base side sits, or nothing for a new lockfile. A
 * rename from a file that is not the same kind of lockfile is new to the
 * package manager, so it has no base side to compare against.
 */
function readBasePath(lockfile: ChangedLockfile): string | undefined {
  if (lockfile.status === DiffFileStatuses.ADDED) {
    return undefined;
  }
  const { path, previousPath } = lockfile;
  if (previousPath === undefined) {
    return path;
  }
  const format = detectLockfile(path);
  const sameLockfile =
    format !== undefined && detectLockfile(previousPath) === format;
  return sameLockfile ? previousPath : undefined;
}

/** One changed lockfile's summary, read in a child process; one that fails reads as unparseable. */
async function summarizeChangedLockfile(
  source: LockfileReads,
  lockfile: ChangedLockfile,
  refs: { base: string | undefined; head: string },
  limits: SpanLimits,
  log: Logger,
): Promise<LockfileSummary | undefined> {
  const basePath = readBasePath(lockfile);
  // One side at a time, so a run holds no more text than the child is handed.
  let before = ABSENT_SIDE;
  if (basePath !== undefined) {
    before =
      refs.base === undefined
        ? UNAVAILABLE_SIDE
        : await readSide(source, basePath, refs.base, log);
  }
  const after =
    lockfile.status === DiffFileStatuses.DELETED
      ? ABSENT_SIDE
      : await readSide(source, lockfile.path, refs.head, log);

  const remainingMs = Math.max(limits.deadline - Date.now(), 0);
  const read =
    remainingMs === 0
      ? BUDGET_SPENT
      : await summarizeInChild(
          lockfile.path,
          { before, after },
          { timeoutMs: remainingMs, stop: limits.stop },
        );
  limits.stop.throwIfAborted();
  if (read.ok) {
    return read.value.summary;
  }
  log.warn("generate: lockfile summary child failed", {
    path: lockfile.path,
    reason: read.error,
  });
  return summarizeUnreadLockfile(
    lockfile.path,
    LockfileReadFailures.UNPARSEABLE,
  );
}

/**
 * The package summary of every pnpm, npm or yarn lockfile `diff` changes,
 * keyed as its chunks are, for the `changes-package-source` rule. Each is
 * read and summarized before the next, so one lockfile's text is held at a
 * time, and every summary runs in its own child process under one span
 * budget.
 */
export async function readLockfileSummaries(
  source: LockfileReads,
  diff: string,
  span: LockfileSpan,
  log: Logger,
  stops: readonly (AbortSignal | undefined)[],
): Promise<Map<string, LockfileSummary>> {
  const summaries = new Map<string, LockfileSummary>();
  const lockfiles = listChangedLockfiles(diff);
  if (lockfiles.length > MAX_LOCKFILES_READ) {
    log.info("generate: lockfiles past the read cap", {
      count: lockfiles.length,
    });
  }
  const readable = lockfiles.slice(0, MAX_LOCKFILES_READ);
  if (readable.length === 0) {
    return summaries;
  }

  const readsBase = readable.some(
    (lockfile) => readBasePath(lockfile) !== undefined,
  );
  const base = readsBase ? await readMergeBase(source, span, log) : undefined;
  const signals = stops.filter((signal) => signal !== undefined);
  const limits: SpanLimits = {
    deadline: Date.now() + SPAN_BUDGET_MS,
    stop: AbortSignal.any(signals),
  };
  for (const lockfile of readable) {
    limits.stop.throwIfAborted();
    // oxlint-disable-next-line no-await-in-loop -- one lockfile's text in memory at a time
    const summary = await summarizeChangedLockfile(
      source,
      lockfile,
      { base, head: span.head },
      limits,
      log,
    );
    if (summary !== undefined) {
      summaries.set(lockfile.path, summary);
    }
  }
  return summaries;
}
