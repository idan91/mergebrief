// Hono-free live reads: the span diff, the stack and the file range. A
// missing PR row is genuinely absent behind the gate, terminal and
// posture-free, so these ops THROW NotFound.
import {
  fetchCompareDiff,
  fetchPullRequest,
  getRepoFile,
  GitHubApiErrorCodes,
  listOpenPullRequests,
  RepoFileKinds,
  type GitHubApiError,
} from "github";
import {
  resolvePrStack,
  type OpenPullRequest,
  type PrStackSelf,
} from "brief-core/pr-stack";
import type { PullRequestRow, RepoId } from "persistence";
import type { Result } from "types";
import type { Logger } from "logging";
import { NotFound } from "../../../../shared-errors/api-error";
import {
  FailureKinds,
  isGitHubDenial,
} from "../../../../shared-errors/failures";
import type {
  ReviewerGitHubClient,
  UserOctokit,
} from "../../../auth/reviewer-github-client";
import type { TtlCache } from "../../../ttl-cache";
import type { FileRangeView, PullStackView } from "contract";
import { buildDiffCacheKey, buildFileBlobCacheKey } from "./logic/keys";
import {
  classifyRepoFile,
  sliceFileRange,
  splitFileLines,
} from "./logic/file-range";
import { collectKnownCommits } from "../../../../access/known-commits";
import {
  recordResolvedStack,
  shapeFetchedSelf,
  shapeRecordedStack,
  shapeStoredStack,
} from "./logic/last-stack";
import {
  DIFF_CACHE_MAX_ENTRY_BYTES,
  DIFF_CACHE_TTL_MS,
  FILE_BLOB_CACHE_TTL_MS,
  FILE_BLOB_MAX_BYTES,
  PR_STACK_OPEN_PULLS_CACHE_TTL_MS,
} from "./consts";
import { buildOpenPullsCacheKey } from "../../../open-pulls-cache";
import type {
  DiffFailure,
  FileRangeFailure,
  ReadsControllerDeps,
  StackFailure,
} from "./types";

interface SpanInput {
  readonly repoId: RepoId;
  readonly prNumber: number;
}

type ReadDiffResult =
  | { readonly ok: true; readonly body: string }
  | { readonly ok: false; readonly error: DiffFailure };

/** One viewer-token read shaped into the stack failure vocabulary. */
async function readWithViewer<T>(
  github: ReviewerGitHubClient,
  read: (octokit: UserOctokit) => Promise<Result<T, GitHubApiError>>,
): Promise<Result<T, StackFailure>> {
  const result = await github.runRead(
    (token) => read(github.createOctokit(token)),
    isGitHubDenial,
  );
  if (result.ok) {
    return { ok: true, value: result.value };
  }
  if (result.tokenUnreadable) {
    return { ok: false, error: { kind: FailureKinds.TOKEN_UNREADABLE } };
  }
  return {
    ok: false,
    error: {
      kind: FailureKinds.GITHUB_DENIED,
      error: result.error,
    },
  };
}

interface StackSelfRead {
  readonly self: PrStackSelf;
  /** GitHub's answer, not the row's state: a lost webhook leaves a row open. */
  readonly open: boolean;
}

/** The PR's own refs: from the open list, else one fetch for a closed PR. */
async function resolveStackSelf(
  github: ReviewerGitHubClient,
  target: { readonly owner: string; readonly repo: string },
  prNumber: number,
  open: readonly OpenPullRequest[],
): Promise<Result<StackSelfRead, StackFailure>> {
  const listed = open.find((item) => item.number === prNumber);
  if (listed !== undefined) {
    return { ok: true, value: { self: listed, open: true } };
  }

  const fetched = await readWithViewer(github, (octokit) =>
    fetchPullRequest(octokit, { ...target, prNumber }),
  );
  if (!fetched.ok) {
    return fetched;
  }
  return {
    ok: true,
    value: {
      self: shapeFetchedSelf(prNumber, fetched.value),
      open: fetched.value.state === "open",
    },
  };
}

interface OperatorReach {
  /** The gate passed this request on the operator token, not the viewer's. */
  readonly urlBoxOnly: boolean;
  readonly refs: readonly string[];
}

/**
 * Whether a read may take the operator rung. The operator token reads the
 * whole repository, so under it every ref must be a full SHA recorded for
 * this pull request; a branch name or short SHA never matches.
 */
async function resolveOperatorReach(
  deps: ReadsControllerDeps,
  pr: PullRequestRow,
  reach: OperatorReach,
): Promise<boolean> {
  if (!reach.urlBoxOnly) {
    return true;
  }

  const [briefs, deltas] = await Promise.all([
    deps.artifacts.briefs.listForPullRequest(pr.id),
    deps.artifacts.deltas.listForPullRequest(pr.id),
  ]);
  const known = collectKnownCommits(pr, briefs, deltas);
  const everyRefKnown = reach.refs.every((ref) => known.has(ref));
  return everyRefKnown;
}

/** A viewer-token read; the operator rung only when the reach allows it. */
function runBoundRead<T>(
  github: ReviewerGitHubClient,
  operatorReadAllowed: boolean,
  call: (token: string) => Promise<Result<T, GitHubApiError>>,
) {
  if (operatorReadAllowed) {
    return github.runRead(call, isGitHubDenial);
  }
  return github.run(call);
}

export const readsController = {
  /**
   * The LIVE diff proxy for the requested `base...head` span, the viewer's
   * token, cached per session (~60s), NEVER persisted. Serve always; cache
   * only when small enough (oversized diffs are rare and cheap to re-proxy).
   */
  async readDiff(
    deps: ReadsControllerDeps & {
      readonly github: ReviewerGitHubClient;
      readonly diffCache: TtlCache<string>;
    },
    input: SpanInput & {
      readonly owner: string;
      readonly repo: string;
      readonly base: string;
      readonly head: string;
      readonly sessionTokenHash: string;
      readonly urlBoxOnly: boolean;
    },
  ) {
    const pr = await deps.tenant.pullRequests.getByNumber(
      input.repoId,
      input.prNumber,
    );
    if (pr === undefined) {
      throw new NotFound();
    }
    const cacheKey = buildDiffCacheKey({
      sessionTokenHash: input.sessionTokenHash,
      repoId: input.repoId,
      prNumber: pr.prNumber,
      base: input.base,
      head: input.head,
    });
    const now = Date.now();
    const cached = deps.diffCache.get(cacheKey, now);
    if (cached !== undefined) {
      return { ok: true, body: cached } satisfies ReadDiffResult;
    }

    // Fetch the diff for the REQUESTED span (base...head), not the whole PR.
    const span = {
      owner: input.owner,
      repo: input.repo,
      base: input.base,
      head: input.head,
    };
    const operatorReadAllowed = await resolveOperatorReach(deps, pr, {
      urlBoxOnly: input.urlBoxOnly,
      refs: [input.base, input.head],
    });
    const diff = await runBoundRead(deps.github, operatorReadAllowed, (token) =>
      fetchCompareDiff(deps.github.createOctokit(token), span),
    );
    if (!diff.ok) {
      if (diff.tokenUnreadable) {
        return {
          ok: false,
          error: { kind: FailureKinds.TOKEN_UNREADABLE },
        } satisfies ReadDiffResult;
      }
      return {
        ok: false,
        error: {
          kind: FailureKinds.GITHUB_DENIED,
          error: diff.error,
        },
      } satisfies ReadDiffResult;
    }
    if (diff.value.length <= DIFF_CACHE_MAX_ENTRY_BYTES) {
      deps.diffCache.set(cacheKey, diff.value, now + DIFF_CACHE_TTL_MS, now);
    }
    return { ok: true, body: diff.value } satisfies ReadDiffResult;
  },
  /**
   * The PR's stack as GitHub has it now, from the repo's open-PR list read
   * with the viewer's token and held per session (~10s) so walking a stack
   * costs one list, not one per PR. A PR missing from the list (closed or
   * merged) is fetched once for its refs so its open neighbours still resolve.
   * A resolve is folded into the row's record: an open PR serves the live
   * resolve, a closed one the record. An operator-token pass gets no stack:
   * the open list names every PR in a repository the reader cannot see.
   */
  async readStack(
    deps: ReadsControllerDeps & {
      readonly github: ReviewerGitHubClient;
      readonly openPullsCache: TtlCache<readonly OpenPullRequest[]>;
      readonly log: Logger;
    },
    input: SpanInput & {
      readonly owner: string;
      readonly repo: string;
      readonly sessionTokenHash: string;
      readonly urlBoxOnly: boolean;
    },
  ): Promise<Result<PullStackView, StackFailure>> {
    const pr = await deps.tenant.pullRequests.getByNumber(
      input.repoId,
      input.prNumber,
    );
    if (pr === undefined) {
      throw new NotFound();
    }
    if (input.urlBoxOnly) {
      return { ok: true, value: { stack: null } };
    }
    const target = { owner: input.owner, repo: input.repo };
    const cacheKey = buildOpenPullsCacheKey({
      sessionTokenHash: input.sessionTokenHash,
      repoId: input.repoId,
    });
    const now = Date.now();
    let open = deps.openPullsCache.get(cacheKey, now);
    if (open === undefined) {
      const listed = await readWithViewer(deps.github, (octokit) =>
        listOpenPullRequests(octokit, target),
      );
      if (!listed.ok) {
        return listed;
      }
      open = listed.value;
      deps.openPullsCache.set(
        cacheKey,
        open,
        now + PR_STACK_OPEN_PULLS_CACHE_TTL_MS,
        now,
      );
    }

    const selfRead = await resolveStackSelf(
      deps.github,
      target,
      input.prNumber,
      open,
    );
    if (!selfRead.ok) {
      return selfRead;
    }

    const stack = resolvePrStack(selfRead.value.self, open);
    if (stack === undefined) {
      return { ok: true, value: shapeStoredStack(pr, selfRead.value.open) };
    }
    const record = await recordResolvedStack(deps, pr, stack, new Date(now));
    if (selfRead.value.open) {
      return { ok: true, value: { stack } };
    }
    return { ok: true, value: shapeRecordedStack(record) };
  },
  /**
   * One file's line window at `ref`, read with the viewer's token. The
   * decoded blob is held per session (~60s) so the file's OTHER hunk edge
   * costs no GitHub call; only the range crosses the wire.
   */
  async readFileRange(
    deps: ReadsControllerDeps & {
      readonly github: ReviewerGitHubClient;
      readonly fileCache: TtlCache<readonly string[]>;
    },
    input: SpanInput & {
      readonly owner: string;
      readonly repo: string;
      readonly ref: string;
      readonly path: string;
      readonly from: number;
      readonly to: number;
      readonly sessionTokenHash: string;
      readonly urlBoxOnly: boolean;
    },
  ): Promise<Result<FileRangeView, FileRangeFailure>> {
    const pr = await deps.tenant.pullRequests.getByNumber(
      input.repoId,
      input.prNumber,
    );
    if (pr === undefined) {
      throw new NotFound();
    }

    const cacheKey = buildFileBlobCacheKey({
      sessionTokenHash: input.sessionTokenHash,
      repoId: input.repoId,
      ref: input.ref,
      path: input.path,
    });
    const now = Date.now();
    const cached = deps.fileCache.get(cacheKey, now);
    if (cached !== undefined) {
      return { ok: true, value: sliceFileRange(cached, input) };
    }

    const operatorReadAllowed = await resolveOperatorReach(deps, pr, {
      urlBoxOnly: input.urlBoxOnly,
      refs: [input.ref],
    });
    const fetched = await runBoundRead(
      deps.github,
      operatorReadAllowed,
      (token) =>
        getRepoFile(deps.github.createOctokit(token), {
          owner: input.owner,
          repo: input.repo,
          path: input.path,
          ref: input.ref,
          maxBytes: FILE_BLOB_MAX_BYTES,
        }),
    );
    if (!fetched.ok) {
      if (fetched.tokenUnreadable) {
        return { ok: false, error: { kind: FailureKinds.TOKEN_UNREADABLE } };
      }
      // A directory, symlink or submodule at this path is PERMANENT for this
      // commit, so it must not reach the retryable upstream posture.
      if (
        fetched.error.code === GitHubApiErrorCodes.NOT_A_BLOB ||
        fetched.error.code === GitHubApiErrorCodes.NOT_TEXT
      ) {
        return { ok: false, error: { kind: "file-not-text" } };
      }
      const denied: FileRangeFailure = {
        kind: FailureKinds.GITHUB_DENIED,
        error: fetched.error,
      };
      return { ok: false, error: denied };
    }

    const file = fetched.value;
    const refused = classifyRepoFile(file);
    if (refused !== undefined) {
      return { ok: false, error: refused };
    }
    if (file.kind !== RepoFileKinds.FILE) {
      return { ok: false, error: { kind: "file-absent" } };
    }
    const lines = splitFileLines(file.content);
    deps.fileCache.set(cacheKey, lines, now + FILE_BLOB_CACHE_TTL_MS, now);
    return { ok: true, value: sliceFileRange(lines, input) };
  },
};
