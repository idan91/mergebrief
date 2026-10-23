// The worker's GitHub boundary: the reads a generate job needs, pre-bound to
// one PR so the task logic never handles bindings or repo coordinates. An
// App-installation job binds the installation; a url-box job binds the
// VIEWER's grant-resolved token, decrypted lazily, per job, never stored,
// with the operator token as the probe-decided backstop.
import {
  bindInstallationGitHub,
  bindOperatorGitHub,
  bindReviewerGitHub,
  GitHubApiErrorCodes,
  RenewalFailureCodes,
  type AppClient,
  type GitHubApiError,
  type GitHubCall,
  type GitHubCallFailure,
  type GitHubReader,
  type InstallationGitHub,
  type InstallationRepoClient,
  type IssueInfo,
  type OperatorToken,
  type OwnedOperatorToken,
  type PullRequestFile,
  type PullRequestInfo,
  type RepoFileResult,
  type RepoReader,
  type ReviewerBindingOptions,
  type ReviewerCredential,
  type ReviewerGitHub,
} from "github";
import type { CompareFiles } from "brief-core";
import type { OpenPullRequest } from "brief-core/pr-stack";
import type { Logger } from "logging";
import {
  createGrantAuth,
  decryptToken,
  type AppDatabase,
  type GrantRowId,
  type InstallationId,
  type KeyProvider,
  type ReviewerId,
} from "persistence";
import { GenerationFailureCodes } from "types/generations";
import { HttpStatuses } from "types/http";
import type { Result } from "types/utils";
import { PermanentJobError, TransientJobError } from "./failure";

/** The Entry comment's operations; only an installation job has them. */
export type EntryComments = Pick<
  InstallationRepoClient,
  "postEntryComment" | "deleteComment" | "fetchComment"
>;

/** The GitHub calls a generate job performs, bound to one (credential, repo, PR). */
export interface PullRequestSource {
  fetchPullRequest(): GitHubCall<PullRequestInfo>;
  fetchPullRequestFiles(): GitHubCall<PullRequestFile[]>;
  listOpenPullRequests(): GitHubCall<OpenPullRequest[]>;
  /**
   * One issue by number, in any repo the bound credential can see: the
   * primary ticket may live in a sibling repo of the installation. On the
   * operator token, the job's own repository only.
   */
  fetchIssue(
    owner: string,
    repo: string,
    number: number,
  ): GitHubCall<IssueInfo>;
  /** The whole-PR unified diff at the current head. */
  fetchDiff(): GitHubCall<string>;
  /** The `base...head` span diff (narrative/marks/delta inputs). */
  fetchCompareDiff(base: string, head: string): GitHubCall<string>;
  /**
   * The `base...head` compare per-file status metadata: the rename/binary/
   * mode signals the anchoring predicate needs and the raw diff cannot carry.
   */
  fetchCompareFiles(base: string, head: string): GitHubCall<CompareFiles>;
  /**
   * One repo file from the DEFAULT BRANCH (`ref` deliberately unset): a PR
   * head must never be able to weaken its own scrutiny.
   */
  fetchRepoFile(path: string, maxBytes: number): GitHubCall<RepoFileResult>;
  /** Absent on a url-box job: the viewer's token never writes. */
  readonly entryComments?: EntryComments;
}

/** One url-box job's credential reference and the PR it reads. */
export interface UrlBoxSourceRequest {
  readonly grantId: GrantRowId;
  readonly repoSlug: string;
  readonly prNumber: number;
  readonly ownerUserId: ReviewerId;
  readonly log: Logger;
}

export interface GitHubPort {
  /** Open a source on one PR as the App installation. */
  openPullRequestSource(
    installationId: InstallationId,
    repoSlug: string,
    prNumber: number,
  ): Promise<PullRequestSource>;
  /**
   * Open a source for a url-box job: resolve the grant, decrypt the viewer's
   * access token, and probe the PR once. A viewer denial switches the job to
   * the operator token when one is configured and `ownerUserId` owns it (a
   * GitHub App user token is installation-scoped and cannot read a private
   * repo the App is not installed on, even for the repo's owner). A denial
   * while the owner lookup is pending is transient. A missing/unreadable
   * grant is a permanent `github-access` failure: the fix is a fresh paste,
   * not a retry.
   */
  openUrlBoxPullRequestSource(
    request: UrlBoxSourceRequest,
  ): Promise<PullRequestSource>;
}

/** The three credential bindings; production binds the App, tests the fake. */
export interface GitHubBinders {
  bindInstallationGitHub(installationId: InstallationId): InstallationGitHub;
  bindReviewerGitHub(
    credential: ReviewerCredential,
    options: ReviewerBindingOptions,
  ): ReviewerGitHub;
  bindOperatorGitHub(token: OperatorToken): GitHubReader;
}

/** What the url-box credential path needs; absent = url-box jobs refuse. */
export interface UrlBoxAuthDeps {
  readonly handle: AppDatabase;
  readonly keyProvider: KeyProvider;
  /** Operator token backstop, serving only its owner; optional. */
  readonly operatorToken?: OwnedOperatorToken;
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

type PullRequestReads = Omit<
  PullRequestSource,
  "listOpenPullRequests" | "entryComments"
>;

/** One binding's reads, bound to one repository's PR. */
function bindPullRequestReads(
  github: GitHubReader,
  reader: RepoReader,
  prNumber: number,
): PullRequestReads {
  return {
    fetchPullRequest: () => reader.fetchPullRequest(prNumber),
    fetchPullRequestFiles: () => reader.fetchPullRequestFiles(prNumber),
    fetchIssue: (owner, repo, number) =>
      github.fetchIssue({ owner, repo, number }),
    fetchDiff: () => reader.fetchDiff(prNumber),
    fetchCompareDiff: (base, head) => reader.fetchCompareDiff({ base, head }),
    fetchCompareFiles: (base, head) => reader.fetchCompareFiles({ base, head }),
    fetchRepoFile: (path, maxBytes) => reader.fetchRepoFile({ path, maxBytes }),
  };
}

/** The open list names every PR in a repository the owner cannot see. */
function listNoOpenPullRequests(): GitHubCall<OpenPullRequest[]> {
  return Promise.resolve({ ok: true, value: [] });
}

/**
 * Serve one already-fetched `fetchPullRequest` result before delegating: the
 * fallback probe's read must not cost the task a second identical GitHub
 * call. One-shot on purpose: the supersession watch's later reads need the
 * LIVE head, never a cached one.
 */
function serveProbeOnce(
  source: PullRequestSource,
  probe: Result<PullRequestInfo, GitHubCallFailure>,
): PullRequestSource {
  let pending: Result<PullRequestInfo, GitHubCallFailure> | undefined = probe;
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
 * The operator token, only for the job's owner when it owns the token. A
 * pending owner lookup cannot answer yet, so the job retries.
 */
function resolveOperatorTokenFor(
  operatorToken: OwnedOperatorToken,
  ownerUserId: ReviewerId,
): OperatorToken | undefined {
  if (operatorToken.isOwnedBy(ownerUserId)) {
    return operatorToken.token;
  }
  if (operatorToken.isLookupPending()) {
    throw new TransientJobError("url-box token owner lookup pending", {
      failure: { code: GenerationFailureCodes.GITHUB_UNAVAILABLE },
    });
  }
  return undefined;
}

/** The worker holds no refresh token path: a rejected viewer token stays rejected. */
function createViewerCredential(token: string): ReviewerCredential {
  return {
    readToken: async () => ({ ok: true, value: token }),
    renewToken: async () => ({
      ok: false,
      error: { code: RenewalFailureCodes.REFUSED },
    }),
  };
}

function isDeniedProbe(
  probe: Result<PullRequestInfo, GitHubCallFailure>,
): boolean {
  if (probe.ok) {
    return false;
  }
  const { code } = probe.error;
  return (
    code === GitHubApiErrorCodes.NOT_FOUND ||
    code === GitHubApiErrorCodes.FORBIDDEN
  );
}

async function readViewerToken(
  urlBox: UrlBoxAuthDeps,
  grantId: GrantRowId,
): Promise<string> {
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
  return token.value;
}

function openInstallationSource(
  binders: GitHubBinders,
  installationId: InstallationId,
  repo: RepoParts,
  prNumber: number,
): PullRequestSource {
  const github = binders.bindInstallationGitHub(installationId);
  const client = github.forRepo(repo);
  return {
    ...bindPullRequestReads(github, client, prNumber),
    listOpenPullRequests: () => client.listOpenPullRequests(),
    entryComments: client,
  };
}

const ISSUE_OUT_OF_REACH: GitHubApiError = {
  code: GitHubApiErrorCodes.NOT_FOUND,
  status: HttpStatuses.NOT_FOUND,
  message: "issue outside the job's repository",
};

function isSameRepository(left: RepoParts, right: RepoParts): boolean {
  const sameOwner = left.owner.toLowerCase() === right.owner.toLowerCase();
  return sameOwner && left.repo.toLowerCase() === right.repo.toLowerCase();
}

/**
 * Url-box jobs read only, so the operator token is never a write path. A
 * ticket in another repository answers not-found unsent: the owner reaches
 * neither repository on a key of their own.
 */
function openOperatorSource(
  binders: GitHubBinders,
  token: OperatorToken,
  repo: RepoParts,
  prNumber: number,
): PullRequestSource {
  const github = binders.bindOperatorGitHub(token);
  const reads = bindPullRequestReads(github, github.forRepo(repo), prNumber);
  return {
    ...reads,
    fetchIssue: async (owner, issueRepo, number) => {
      if (!isSameRepository(repo, { owner, repo: issueRepo })) {
        return { ok: false, error: ISSUE_OUT_OF_REACH };
      }
      return reads.fetchIssue(owner, issueRepo, number);
    },
    listOpenPullRequests: listNoOpenPullRequests,
  };
}

async function openUrlBoxSource(
  binders: GitHubBinders,
  urlBox: UrlBoxAuthDeps,
  request: UrlBoxSourceRequest,
): Promise<PullRequestSource> {
  const { grantId, repoSlug, prNumber, ownerUserId, log } = request;
  const repo = splitRepoSlugOrThrow(repoSlug, prNumber);
  const token = await readViewerToken(urlBox, grantId);

  const viewer = binders.bindReviewerGitHub(createViewerCredential(token), {
    log,
  });
  const client = viewer.forRepo(repo);
  const viewerSource: PullRequestSource = {
    ...bindPullRequestReads(viewer, client, prNumber),
    listOpenPullRequests: () => client.listOpenPullRequests(),
  };
  const { operatorToken } = urlBox;
  if (operatorToken === undefined) {
    return viewerSource;
  }
  const mayServeOwner =
    operatorToken.isOwnedBy(ownerUserId) || operatorToken.isLookupPending();
  if (!mayServeOwner) {
    return viewerSource;
  }

  // One probe decides the whole job's credential: a denial runs every read
  // on the operator token; any other outcome keeps the viewer, with the
  // probe result served once and the task's own reads surfacing any error.
  const probe = await viewerSource.fetchPullRequest();
  if (!isDeniedProbe(probe)) {
    return serveProbeOnce(viewerSource, probe);
  }
  const ownedToken = resolveOperatorTokenFor(operatorToken, ownerUserId);
  if (ownedToken === undefined) {
    return serveProbeOnce(viewerSource, probe);
  }
  return openOperatorSource(binders, ownedToken, repo, prNumber);
}

/** The App's installation binding and the package's reviewer and operator bindings. */
export function createAppGitHubBinders(app: AppClient): GitHubBinders {
  return {
    bindInstallationGitHub: (installationId) =>
      bindInstallationGitHub(app, installationId),
    bindReviewerGitHub,
    bindOperatorGitHub,
  };
}

/**
 * The task's port over `binders`. `urlBox` absent = url-box jobs fail
 * permanently: the operator wired no credential path.
 */
export function createGitHubPort(
  binders: GitHubBinders,
  urlBox?: UrlBoxAuthDeps,
): GitHubPort {
  return {
    async openPullRequestSource(installationId, repoSlug, prNumber) {
      const repo = splitRepoSlugOrThrow(repoSlug, prNumber);
      return openInstallationSource(binders, installationId, repo, prNumber);
    },

    async openUrlBoxPullRequestSource(request) {
      if (urlBox === undefined) {
        throw buildPermanentAccessFailure(
          "url-box job with no viewer credential path configured",
        );
      }
      return openUrlBoxSource(binders, urlBox, request);
    },
  };
}
