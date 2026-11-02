import {
  BlobReadKinds,
  PrSpanFailureKinds,
  type BlobRead,
  type PrDiffRef,
  type PrSpanFailure,
  type PrSpanSource,
} from "brief-core/pr-span";
import {
  GitHubApiErrorCodes,
  isPermanentGitHubError,
  isSpanUnrendered,
  RepoFileKinds,
  type GitHubCallFailure,
  type RepoFileResult,
} from "github";
import type { Result } from "types/utils";
import type { PullRequestSource } from "../../github-port";

type SpanReads = Pick<
  PullRequestSource,
  "fetchCheckedCompareDiff" | "fetchRepoFileAt" | "fetchMergeBase"
>;

/** Bytes GitHub will never serve as file text at this path and ref. */
const UNREADABLE_BLOB_CODES: ReadonlySet<string> = new Set([
  GitHubApiErrorCodes.NOT_A_BLOB,
  GitHubApiErrorCodes.NOT_TEXT,
]);

/** A span GitHub would not render is too large; a ref it will not serve is unavailable; the rest a retry may clear. */
function readFailureKind(error: GitHubCallFailure): PrSpanFailure["kind"] {
  if (isSpanUnrendered(error)) {
    return PrSpanFailureKinds.TOO_LARGE;
  }
  if (isPermanentGitHubError(error)) {
    return PrSpanFailureKinds.UNAVAILABLE;
  }
  return PrSpanFailureKinds.TRANSIENT;
}

function readBlob(file: RepoFileResult): BlobRead {
  if (file.kind === RepoFileKinds.FILE) {
    return { kind: BlobReadKinds.TEXT, content: file.content };
  }
  if (file.kind === RepoFileKinds.ABSENT) {
    return { kind: BlobReadKinds.ABSENT };
  }
  return { kind: BlobReadKinds.UNREADABLE };
}

/** A PR diff whose changed-file count GitHub reported: the job's head against the PR's base. */
export interface CountedPrDiff {
  readonly base: string;
  readonly head: string;
  readonly fileCount: number;
}

function readExpectedFileCount(
  span: PrDiffRef,
  counted: CountedPrDiff | undefined,
): number | undefined {
  if (counted?.base !== span.base || counted.head !== span.head) {
    return undefined;
  }
  return counted.fileCount;
}

function failSpan(error: GitHubCallFailure): Result<never, PrSpanFailure> {
  return { ok: false, error: { kind: readFailureKind(error) } };
}

/**
 * The revision span read over the job's bound GitHub source: each head's PR
 * diff through the checked compare, which refuses a diff short of its
 * declared length or, for the `counted` span, of its file count; blobs at
 * a ref; and merge bases. The source takes no signal, so an aborted run rejects as each read
 * returns.
 */
export function buildWorkerPrSpanSource(
  reads: SpanReads,
  counted?: CountedPrDiff,
): PrSpanSource {
  return {
    async fetchPrDiff(span, signal) {
      const diff = await reads.fetchCheckedCompareDiff(
        span.base,
        span.head,
        readExpectedFileCount(span, counted),
      );
      signal.throwIfAborted();
      return diff.ok ? diff : failSpan(diff.error);
    },
    async fetchBlob(blob, signal) {
      const file = await reads.fetchRepoFileAt(
        blob.path,
        blob.ref,
        blob.maxBytes,
      );
      signal.throwIfAborted();
      if (file.ok) {
        return { ok: true, value: readBlob(file.value) };
      }
      if (UNREADABLE_BLOB_CODES.has(file.error.code)) {
        return { ok: true, value: { kind: BlobReadKinds.UNREADABLE } };
      }
      return failSpan(file.error);
    },
    async fetchMergeBase(span, signal) {
      const mergeBase = await reads.fetchMergeBase(span.base, span.head);
      signal.throwIfAborted();
      return mergeBase.ok ? mergeBase : failSpan(mergeBase.error);
    },
  };
}
