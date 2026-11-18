import { once } from "node:events";
import {
  BlobReadKinds,
  PrSpanFailureKinds,
  type BlobRead,
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
  type ReviewerRepoClient,
} from "github";
import type { Result } from "types/utils";

type PrSpanFailureKind = PrSpanFailure["kind"];

/** The reads a span needs from the viewer's binding to one repository. */
export type SpanReader = Pick<
  ReviewerRepoClient,
  "fetchCheckedCompareDiff" | "fetchMergeBase" | "fetchRepoFile"
>;

/** The span source, and the GitHub failure behind each failure kind it answered. */
export interface ApiPrSpanSource {
  readonly source: PrSpanSource;
  readFailure(kind: PrSpanFailureKind): GitHubCallFailure | undefined;
}

/** Bytes GitHub will never serve as file text at this path and ref. */
const UNREADABLE_BLOB_CODES: ReadonlySet<string> = new Set([
  GitHubApiErrorCodes.NOT_A_BLOB,
  GitHubApiErrorCodes.NOT_TEXT,
]);

/** A credential GitHub refused asks the viewer to sign in again, so it outranks any other failure of its kind. */
function outranks(
  error: GitHubCallFailure,
  recorded: GitHubCallFailure,
): boolean {
  const unauthorized = GitHubApiErrorCodes.UNAUTHORIZED;
  return error.code === unauthorized && recorded.code !== unauthorized;
}

/** A span GitHub would not render is too large; a ref it will not serve is unavailable; the rest a retry may clear. */
function readFailureKind(error: GitHubCallFailure): PrSpanFailureKind {
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

/** The call's answer, or the signal's reason once it aborts first; the call itself runs on. */
async function awaitBeforeAbort<Value>(
  call: Promise<Value>,
  signal: AbortSignal,
): Promise<Value> {
  signal.throwIfAborted();
  const settled = new AbortController();
  const aborted = once(signal, "abort", { signal: settled.signal }).then(
    () => Promise.reject(signal.reason),
    () => new Promise<never>(() => undefined),
  );
  try {
    return await Promise.race([call, aborted]);
  } finally {
    settled.abort();
  }
}

/**
 * The revision span read over the viewer's binding: each PR diff through the
 * checked compare on the time left before `deadlineAt`, blobs at a ref, and
 * merge bases. A read the deadline signal aborts rejects with its reason.
 */
export function buildApiPrSpanSource(
  reader: SpanReader,
  deadlineAt: number,
): ApiPrSpanSource {
  const failures = new Map<PrSpanFailureKind, GitHubCallFailure>();

  function failSpan(error: GitHubCallFailure): Result<never, PrSpanFailure> {
    const kind = readFailureKind(error);
    const recorded = failures.get(kind);
    if (recorded === undefined || outranks(error, recorded)) {
      failures.set(kind, error);
    }
    return { ok: false, error: { kind } };
  }

  const source: PrSpanSource = {
    async fetchPrDiff(span, signal) {
      const deadlineMs = Math.max(deadlineAt - Date.now(), 0);
      const call = reader.fetchCheckedCompareDiff({ ...span, deadlineMs });
      const diff = await awaitBeforeAbort(call, signal);
      return diff.ok ? diff : failSpan(diff.error);
    },
    async fetchBlob(blob, signal) {
      const call = reader.fetchRepoFile(blob);
      const file = await awaitBeforeAbort(call, signal);
      if (file.ok) {
        return { ok: true, value: readBlob(file.value) };
      }
      if (UNREADABLE_BLOB_CODES.has(file.error.code)) {
        return { ok: true, value: { kind: BlobReadKinds.UNREADABLE } };
      }
      return failSpan(file.error);
    },
    async fetchMergeBase(span, signal) {
      const call = reader.fetchMergeBase(span);
      const mergeBase = await awaitBeforeAbort(call, signal);
      return mergeBase.ok ? mergeBase : failSpan(mergeBase.error);
    },
  };
  return { source, readFailure: (kind) => failures.get(kind) };
}
