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
  type LockfileReadFailure,
  type LockfileSide,
  type LockfileSides,
  type LockfileSummary,
} from "brief-core/shortened";
import { GitHubApiErrorCodes, RepoFileKinds } from "github";
import type { Logger } from "logging";
import type { Result } from "types/utils";
import type { PullRequestSource } from "../../../github-port";
import {
  isPermanentGitHubError,
  isRepoFileRefusedForGood,
  throwOnGitHubFailure,
} from "../errors";
import { summarizeInChild } from "./isolated-summary";
import {
  LockfileSpanKinds,
  SummaryFailures,
  type LockfileSpan,
  type RevisionLockfileSpan,
  type SpanLimits,
  type SummaryFailure,
  type SummaryReply,
} from "./types";

type LockfileReads = Pick<
  PullRequestSource,
  "fetchRepoFileAt" | "fetchMergeBase"
>;

/** Where a lockfile's sides are read: `base` (none when unread) and `head`, plus each head's merge base over a rebase. */
interface SideRefs {
  readonly base: string | undefined;
  readonly head: string;
  readonly mergeBases?: { readonly before: string; readonly after: string };
}

/** Lockfiles read per span; one past it has no summary, so it fires. */
const MAX_LOCKFILES_READ = 20;
/** Wall-clock time every lockfile child of one span shares; a lockfile past it reads as unparseable. */
const SPAN_BUDGET_MS = 60_000;

/** A lockfile past the span budget reads as timed out, with no child forked. */
const BUDGET_SPENT: Result<SummaryReply, SummaryFailure> = {
  ok: false,
  error: SummaryFailures.TIMED_OUT,
};

const ABSENT_SIDE: LockfileSide = { kind: LockfileSideKinds.ABSENT };
const UNAVAILABLE_SIDE: LockfileSide = { kind: LockfileSideKinds.UNAVAILABLE };

/**
 * A side the diff says exists. Content GitHub refuses for good (a missing
 * file, a non-file, one over the cap) reads unavailable, which fails
 * closed; a failure a retry may clear throws for graphile's retry. At a
 * merge base the diff says nothing, so a missing file is `missing`.
 */
async function readSide(
  source: LockfileReads,
  path: string,
  ref: string,
  log: Logger,
  missing: LockfileSide = UNAVAILABLE_SIDE,
): Promise<LockfileSide> {
  const read = await source.fetchRepoFileAt(path, ref, LOCKFILE_MAX_BYTES);
  if (!read.ok && !isRepoFileRefusedForGood(read.error)) {
    throwOnGitHubFailure(read);
  }
  const isMissing =
    !read.ok && read.error.code === GitHubApiErrorCodes.NOT_FOUND;
  if (isMissing && missing.kind === LockfileSideKinds.ABSENT) {
    return missing;
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

/** The merge base of `base` and `head`; a permanent refusal leaves none. */
async function readMergeBase(
  source: LockfileReads,
  base: string,
  head: string,
  log: Logger,
): Promise<string | undefined> {
  const read = await source.fetchMergeBase(base, head);
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

const MERGE_BASE_UNREAD: Result<SideRefs, LockfileReadFailure> = {
  ok: false,
  error: LockfileReadFailures.UNAVAILABLE,
};

/**
 * A revision span compares the two heads. Over one merge base that is each
 * head's own change; over two, each head is read beside its own merge base.
 * An unread merge base leaves every lockfile unread: the heads alone miss a
 * source the PR kept after the base moved off it.
 */
async function readRevisionRefs(
  source: LockfileReads,
  span: RevisionLockfileSpan,
  log: Logger,
): Promise<Result<SideRefs, LockfileReadFailure>> {
  const heads: SideRefs = { base: span.base, head: span.head };
  const before = await readMergeBase(
    source,
    span.refs.prevBase,
    span.base,
    log,
  );
  const after = await readMergeBase(source, span.refs.newBase, span.head, log);
  if (before === undefined || after === undefined) {
    return MERGE_BASE_UNREAD;
  }
  if (before === after) {
    return { ok: true, value: heads };
  }
  return { ok: true, value: { ...heads, mergeBases: { before, after } } };
}

/** The whole PR's lockfile base side sits at its merge base, as the PR diff is taken from it. */
async function readSideRefs(
  source: LockfileReads,
  span: LockfileSpan,
  readsBase: boolean,
  log: Logger,
): Promise<Result<SideRefs, LockfileReadFailure>> {
  if (span.kind === LockfileSpanKinds.REVISION) {
    return readRevisionRefs(source, span, log);
  }
  const base = readsBase
    ? await readMergeBase(source, span.base, span.head, log)
    : undefined;
  return { ok: true, value: { base, head: span.head } };
}

function getDirectory(path: string): string {
  return path.slice(0, path.lastIndexOf("/") + 1);
}

/**
 * Where the lockfile's base side sits, or nothing for a new lockfile. A
 * rename from another folder, or from a file that is not the same kind of
 * lockfile, is new to the package manager, so it has no base side to
 * compare against.
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
    format !== undefined &&
    detectLockfile(previousPath) === format &&
    getDirectory(previousPath) === getDirectory(path);
  return sameLockfile ? previousPath : undefined;
}

/** The lockfile at each head's merge base, where its PR change starts. */
async function readMergeBaseSides(
  source: LockfileReads,
  lockfile: ChangedLockfile,
  refs: SideRefs,
  log: Logger,
): Promise<LockfileSides | undefined> {
  if (refs.mergeBases === undefined) {
    return undefined;
  }
  const beforePath = readBasePath(lockfile) ?? lockfile.path;
  const { mergeBases } = refs;
  const before = await readSide(
    source,
    beforePath,
    mergeBases.before,
    log,
    ABSENT_SIDE,
  );
  const after = await readSide(
    source,
    lockfile.path,
    mergeBases.after,
    log,
    ABSENT_SIDE,
  );
  return { before, after };
}

/** One changed lockfile's summary, read in a child process; one that fails reads as unparseable. */
async function summarizeChangedLockfile(
  source: LockfileReads,
  lockfile: ChangedLockfile,
  refs: SideRefs,
  limits: SpanLimits,
  log: Logger,
): Promise<LockfileSummary | undefined> {
  const basePath = readBasePath(lockfile);
  // One side at a time, so a run holds no more text than the child is handed.
  const mergeBases = await readMergeBaseSides(source, lockfile, refs, log);
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
          mergeBases,
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

function summarizeUnreadLockfiles(
  lockfiles: readonly ChangedLockfile[],
  failure: LockfileReadFailure,
): Map<string, LockfileSummary> {
  const summaries = new Map<string, LockfileSummary>();
  for (const { path } of lockfiles) {
    const summary = summarizeUnreadLockfile(path, failure);
    if (summary !== undefined) {
      summaries.set(path, summary);
    }
  }
  return summaries;
}

/**
 * The package summary of every pnpm, npm or yarn lockfile `diff` changes,
 * keyed as its chunks are, for the `changes-package-source` rule. Each is
 * read and summarized before the next, so one lockfile's sides are held at
 * a time, and every summary runs in its own child process under one span
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
  const refs = await readSideRefs(source, span, readsBase, log);
  if (!refs.ok) {
    return summarizeUnreadLockfiles(readable, refs.error);
  }
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
      refs.value,
      limits,
      log,
    );
    if (summary !== undefined) {
      summaries.set(lockfile.path, summary);
    }
  }
  return summaries;
}
