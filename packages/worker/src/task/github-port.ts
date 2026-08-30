// The worker's GitHub boundary: the reads a generate job needs, pre-bound to
// one PR so the task logic never handles octokit instances or repo
// coordinates. Two credential worlds share one binding: an App-installation
// job mints an installation-scoped client (the worker acts as the App); a
// url-box job resolves its `grant_id` into the VIEWER's token — decrypted
// lazily, per job, never stored — with the operator PAT as the documented
// backstop. Tests substitute an in-memory port.
import {
  createUserOctokit,
  deleteComment,
  fetchComment,
  fetchCompareDiff,
  fetchCompareFiles,
  fetchDiff,
  fetchPullRequest,
  fetchPullRequestFiles,
  getInstallationClient,
  getRepoFile,
  GitHubApiErrorCode,
  postEntryComment,
  type AppClient,
  type CompareFiles,
  type GitHubApiError,
  type PullRequestFile,
  type PullRequestInfo,
  type RepoFileResult,
} from "github";
import {
  createGrantAuth,
  decryptToken,
  GenerationFailureCodes,
  type AppDatabase,
  type GrantRowId,
  type InstallationId,
  type KeyProvider,
} from "persistence";
import type { Result } from "types";
import { PermanentJobError } from "./failure";

export type {
  CompareFiles,
  GitHubApiError,
  PullRequestFile,
  PullRequestInfo,
  RepoFileResult,
};

/** The GitHub calls a generate job performs, bound to one (installation, repo, PR). */
export interface PullRequestSource {
  fetchPullRequest(): Promise<Result<PullRequestInfo, GitHubApiError>>;
  fetchPullRequestFiles(): Promise<Result<PullRequestFile[], GitHubApiError>>;
  /** The whole-PR unified diff at the current head. */
  fetchDiff(): Promise<Result<string, GitHubApiError>>;
  /** The `base...head` span diff (narrative/marks/delta inputs). */
  fetchCompareDiff(
    base: string,
    head: string,
  ): Promise<Result<string, GitHubApiError>>;
  /**
   * The `base...head` compare per-file status metadata — the rename/binary/
   * mode signals the anchoring predicate needs and the raw diff cannot carry.
   */
  fetchCompareFiles(
    base: string,
    head: string,
  ): Promise<Result<CompareFiles, GitHubApiError>>;
  /**
   * One repo file from the DEFAULT BRANCH (`ref` deliberately unset): a PR
   * head must never be able to weaken its own scrutiny.
   */
  fetchRepoFile(
    path: string,
    maxBytes: number,
  ): Promise<Result<RepoFileResult, GitHubApiError>>;
  /** Post the branded Entry comment; returns the comment id. */
  postEntryComment(
    body: string,
  ): Promise<Result<{ readonly commentId: bigint }, GitHubApiError>>;
  /** Delete a prior Entry comment; a 404 (already gone) maps to ok. */
  deleteComment(commentId: bigint): Promise<Result<void, GitHubApiError>>;
  /** Read a prior Entry comment's live body; a 404 (gone) maps to ok undefined. */
  fetchComment(
    commentId: bigint,
  ): Promise<Result<{ readonly body: string } | undefined, GitHubApiError>>;
}

export interface GitHubPort {
  /**
   * Open a source on one PR. `repoSlug` is the stored `owner/repo` full name;
   * minting the installation token is the only network side effect.
   */
  openPullRequestSource(
    installationId: InstallationId,
    repoSlug: string,
    prNumber: number,
  ): Promise<PullRequestSource>;
  /**
   * Open a source for a url-box job: resolve the grant, decrypt the viewer's
   * access token, and probe the PR once — a viewer denial falls back to the
   * operator PAT when one is configured (a GitHub App user token is
   * installation-scoped and cannot read a private repo the App is not
   * installed on, even for the repo's owner). A missing/unreadable grant is a
   * permanent `github-access` failure — the fix is a fresh paste, not a retry.
   */
  openUrlBoxPullRequestSource(
    grantId: GrantRowId,
    repoSlug: string,
    prNumber: number,
  ): Promise<PullRequestSource>;
}

/** What the url-box credential path needs; absent = url-box jobs refuse. */
export interface UrlBoxAuthDeps {
  readonly handle: AppDatabase;
  readonly keyProvider: KeyProvider;
  /** Operator PAT backstop (`MERGEBRIEF_URL_BOX_TOKEN`); optional. */
  readonly fallbackToken?: string;
}

/** The two halves of a stored `owner/repo` full name. */
export interface RepoParts {
  readonly owner: string;
  readonly repo: string;
}

/** Split a stored `owner/repo` slug; `undefined` when malformed. */
export function splitRepoSlug(slug: string): RepoParts | undefined {
  const parts = slug.split("/");
  const [owner, repo] = parts;
  if (parts.length !== 2 || !owner || !repo) {
    return undefined;
  }
  return { owner, repo };
}

type BoundOctokit = Parameters<typeof fetchPullRequest>[0];

function splitRepoSlugOrThrow(repoSlug: string, prNumber: number): RepoParts {
  const split = splitRepoSlug(repoSlug);
  if (split === undefined) {
    // Programmer/data error: the slug came from our own row.
    throw new Error(
      `malformed repo slug on pull_request row (number ${prNumber})`,
    );
  }
  return split;
}

/** The client-agnostic closure wiring: one octokit + one PR ref → source. */
function bindPullRequestSource(
  octokit: BoundOctokit,
  ref: RepoParts & { readonly prNumber: number },
): PullRequestSource {
  return {
    fetchPullRequest: () => fetchPullRequest(octokit, ref),
    fetchPullRequestFiles: () => fetchPullRequestFiles(octokit, ref),
    fetchDiff: () => fetchDiff(octokit, ref),
    fetchCompareDiff: (base, head) =>
      fetchCompareDiff(octokit, {
        owner: ref.owner,
        repo: ref.repo,
        base,
        head,
      }),
    fetchCompareFiles: (base, head) =>
      fetchCompareFiles(octokit, {
        owner: ref.owner,
        repo: ref.repo,
        base,
        head,
      }),
    fetchRepoFile: (path, maxBytes) =>
      getRepoFile(octokit, {
        owner: ref.owner,
        repo: ref.repo,
        path,
        maxBytes,
      }),
    postEntryComment: (body) =>
      postEntryComment(octokit, {
        owner: ref.owner,
        repo: ref.repo,
        prNumber: ref.prNumber,
        body,
      }),
    deleteComment: (commentId) =>
      deleteComment(octokit, {
        owner: ref.owner,
        repo: ref.repo,
        commentId,
      }),
    fetchComment: (commentId) =>
      fetchComment(octokit, {
        owner: ref.owner,
        repo: ref.repo,
        commentId,
      }),
  };
}

/**
 * Serve one already-fetched `fetchPullRequest` result before delegating: the
 * fallback probe's read must not cost the task a second identical GitHub
 * call. One-shot on purpose — the supersession watch's later reads need the
 * LIVE head, never a cached one.
 */
function serveProbeOnce(
  source: PullRequestSource,
  probe: Result<PullRequestInfo, GitHubApiError>,
): PullRequestSource {
  let pending: Result<PullRequestInfo, GitHubApiError> | undefined = probe;
  return {
    ...source,
    fetchPullRequest: async () => {
      if (pending !== undefined) {
        const served = pending;
        pending = undefined;
        return served;
      }
      return source.fetchPullRequest();
    },
  };
}

function buildPermanentAccessFailure(message: string): PermanentJobError {
  return new PermanentJobError(message, {
    failure: { code: GenerationFailureCodes.GITHUB_ACCESS },
  });
}

/**
 * The production port: App-JWT client for installation jobs; grant-resolved
 * viewer token (+ PAT backstop) for url-box jobs. `urlBox` absent = url-box
 * jobs fail permanently — the operator wired no credential path.
 */
export function appGitHubPort(
  app: AppClient,
  urlBox?: UrlBoxAuthDeps,
): GitHubPort {
  return {
    async openPullRequestSource(installationId, repoSlug, prNumber) {
      const split = splitRepoSlugOrThrow(repoSlug, prNumber);
      const octokit = await getInstallationClient(app, installationId);
      return bindPullRequestSource(octokit, { ...split, prNumber });
    },

    async openUrlBoxPullRequestSource(grantId, repoSlug, prNumber) {
      if (urlBox === undefined) {
        throw buildPermanentAccessFailure(
          "url-box job with no viewer credential path configured",
        );
      }
      const split = splitRepoSlugOrThrow(repoSlug, prNumber);
      const ref = { ...split, prNumber };
      const grant = await createGrantAuth(urlBox.handle).getGrant(grantId);
      if (grant === undefined) {
        // The referencing session logged out between enqueue and drain and
        // the grant was orphan-cleaned; a retry cannot bring it back.
        throw buildPermanentAccessFailure("github_grant no longer exists");
      }
      const token = await decryptToken(
        urlBox.keyProvider,
        grant.keyRef,
        grant.ghTokenCiphertext,
      );
      if (!token.ok) {
        throw buildPermanentAccessFailure(
          `viewer token unreadable (${token.error.code})`,
        );
      }
      const viewerSource = bindPullRequestSource(
        createUserOctokit(token.value),
        ref,
      );
      if (urlBox.fallbackToken === undefined) {
        return viewerSource;
      }
      // One probe decides the fallback: a GitHub App user token cannot read a
      // private repo the App is not installed on, so a denial here retries as
      // the operator PAT. Any other outcome keeps the viewer binding — with
      // the probe result served once, so the task's first read is free — and
      // lets the task's own reads surface any real error.
      const probe = await viewerSource.fetchPullRequest();
      if (
        !probe.ok &&
        (probe.error.code === GitHubApiErrorCode.NOT_FOUND ||
          probe.error.code === GitHubApiErrorCode.FORBIDDEN)
      ) {
        return bindPullRequestSource(
          createUserOctokit(urlBox.fallbackToken),
          ref,
        );
      }
      return serveProbeOnce(viewerSource, probe);
    },
  };
}
