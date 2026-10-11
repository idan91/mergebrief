import type { InstallationId, RepoId } from "persistence";
import type { UserInstallation } from "../auth/oauth";
import type { RepoCollaborators } from "../operations/collaborators";
import type { PrConversation } from "../operations/conversation";
import type { IssueInfo, IssueRef } from "../operations/issue";
import type {
  PullRequestFile,
  PullRequestInfo,
  PullRequestRef,
  RepositoryRef,
} from "../operations/pull-request/types";
import type {
  InstallationRepository,
  RepositoryInfo,
} from "../operations/repo";
import type { RepoFileResult } from "../operations/repo-file";
import type { ReviewCommentListing } from "../operations/review-comment-list";
import { FIRST_IDS } from "./consts";
import type {
  FakeCompare,
  FakeGitHubArrange,
  FakePullRequest,
  FakeReview,
} from "./types";

export type IdKind = keyof typeof FIRST_IDS;

export interface PullRequestState {
  info: PullRequestInfo;
  readonly files: readonly PullRequestFile[];
  readonly diff: string;
  conversation: PrConversation;
  readonly imageSources: readonly string[];
  reviews: FakeReview[];
  readonly reviewComments: ReviewCommentListing;
}

export interface RepoState {
  readonly pullRequests: Map<number, PullRequestState>;
  readonly compares: Map<string, FakeCompare>;
  readonly files: Map<string, RepoFileResult>;
  readonly comments: Map<bigint, string>;
  readonly branches: Set<string>;
  collaborators: RepoCollaborators;
}

export interface InstallationState {
  readonly installation: UserInstallation;
  readonly repositories: ReadonlyMap<RepoId, InstallationRepository>;
}

export type WorldArrange = Omit<FakeGitHubArrange, "failOn" | "rejectToken">;

/** GitHub's state as the fake holds it; every key ignores case like GitHub. */
export interface FakeWorld extends WorldArrange {
  findRepo(repo: RepositoryRef): RepoState | undefined;
  findPullRequest(ref: PullRequestRef): PullRequestState | undefined;
  findRepository(repoId: RepoId): RepositoryInfo | undefined;
  findIssue(ref: IssueRef): IssueInfo | undefined;
  findInstallation(id: InstallationId): InstallationState | undefined;
  listInstallations(): UserInstallation[];
  claimId(kind: IdKind): bigint;
}

const EMPTY_CONVERSATION: PrConversation = {
  threads: [],
  reviews: [],
  prComments: [],
  hasMoreThreads: false,
  hasMoreReviews: false,
  hasMorePrComments: false,
};

export function getRepoKey(repo: RepositoryRef): string {
  return `${repo.owner}/${repo.repo}`.toLowerCase();
}

export function getCompareKey(base: string, head: string): string {
  return `${base}...${head}`;
}

export function getFileKey(path: string, ref: string | undefined): string {
  return `${ref ?? ""}:${path}`;
}

function getIssueKey(ref: IssueRef): string {
  return `${getRepoKey(ref)}#${ref.number}`;
}

function createRepoState(): RepoState {
  return {
    pullRequests: new Map(),
    compares: new Map(),
    files: new Map(),
    comments: new Map(),
    branches: new Set(),
    collaborators: { collaborators: [], hasMore: false },
  };
}

function createPullRequestState(pull: FakePullRequest): PullRequestState {
  return {
    info: pull.info,
    files: pull.files ?? [],
    diff: pull.diff ?? "",
    conversation: pull.conversation ?? EMPTY_CONVERSATION,
    imageSources: pull.imageSources ?? [],
    reviews: [...(pull.reviews ?? [])],
    reviewComments: pull.reviewComments ?? { comments: [], complete: true },
  };
}

interface WorldState {
  readonly repos: Map<string, RepoState>;
  readonly repositories: Map<RepoId, RepositoryInfo>;
  readonly issues: Map<string, IssueInfo>;
  readonly installations: Map<InstallationId, InstallationState>;
  readonly nextIds: Record<IdKind, bigint>;
}

function reserveId(state: WorldState, kind: IdKind, id: bigint): void {
  if (id >= state.nextIds[kind]) {
    state.nextIds[kind] = id + 1n;
  }
}

function ensureRepo(state: WorldState, repo: RepositoryRef): RepoState {
  const key = getRepoKey(repo);
  const existing = state.repos.get(key);
  if (existing !== undefined) {
    return existing;
  }
  const created = createRepoState();
  state.repos.set(key, created);
  return created;
}

function buildArrange(state: WorldState): WorldArrange {
  return {
    addRepository(info) {
      state.repositories.set(info.repoId, info);
    },
    addPullRequest(ref, pull) {
      for (const review of pull.reviews ?? []) {
        reserveId(state, "REVIEW", review.reviewId);
      }
      for (const comment of pull.reviewComments?.comments ?? []) {
        reserveId(state, "REVIEW_COMMENT", comment.commentId);
      }
      const pullRequests = ensureRepo(state, ref).pullRequests;
      pullRequests.set(ref.prNumber, createPullRequestState(pull));
    },
    addCompare(repo, span, compare) {
      const key = getCompareKey(span.base, span.head);
      ensureRepo(state, repo).compares.set(key, compare);
    },
    addRepoFile(repo, file, result) {
      const key = getFileKey(file.path, file.ref);
      ensureRepo(state, repo).files.set(key, result);
    },
    addIssue(ref, issue) {
      state.issues.set(getIssueKey(ref), issue);
    },
    addInstallation(installation, repositories) {
      const { installationId } = installation;
      state.installations.set(installationId, { installation, repositories });
    },
    addCollaborators(repo, listing) {
      ensureRepo(state, repo).collaborators = listing;
    },
    addComment(repo, commentId, body) {
      reserveId(state, "ISSUE_COMMENT", commentId);
      ensureRepo(state, repo).comments.set(commentId, body);
    },
    addBranch(repo, branch) {
      ensureRepo(state, repo).branches.add(branch);
    },
  };
}

type WorldLookups = Omit<FakeWorld, keyof WorldArrange>;

function buildLookups(state: WorldState): WorldLookups {
  return {
    findRepo(repo) {
      return state.repos.get(getRepoKey(repo));
    },
    findPullRequest(ref) {
      return state.repos.get(getRepoKey(ref))?.pullRequests.get(ref.prNumber);
    },
    findRepository(repoId) {
      return state.repositories.get(repoId);
    },
    findIssue(ref) {
      return state.issues.get(getIssueKey(ref));
    },
    findInstallation(id) {
      return state.installations.get(id);
    },
    listInstallations() {
      const entries = [...state.installations.values()];
      return entries.map((entry) => entry.installation);
    },
    claimId(kind) {
      const claimed = state.nextIds[kind];
      state.nextIds[kind] = claimed + 1n;
      return claimed;
    },
  };
}

export function createFakeWorld(): FakeWorld {
  const state: WorldState = {
    repos: new Map(),
    repositories: new Map(),
    issues: new Map(),
    installations: new Map(),
    nextIds: { ...FIRST_IDS },
  };
  return { ...buildArrange(state), ...buildLookups(state) };
}
