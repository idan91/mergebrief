import type { InstallationId, RepoId } from "persistence";
import type { UserInstallation } from "../auth/oauth";
import type { CollaboratorPermission } from "../operations/collaborator-permission/types";
import type { RepoCollaborators } from "../operations/collaborators";
import type { PrConversation } from "../operations/conversation";
import type {
  MentionableTeam,
  MentionableUser,
} from "../operations/mentions/types";
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
import { RepositoryVisibilities, type RepositoryVisibility } from "../types";
import { FIRST_IDS } from "./consts";
import type {
  CredentialKind,
  FakeCommentThread,
  FakeCompare,
  FakeFactsHiding,
  FakeFailure,
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
  readonly videoSources: readonly string[];
  reviews: FakeReview[];
  readonly reviewComments: ReviewCommentListing;
  readonly rejectedAnchorPaths: ReadonlySet<string>;
}

export interface RepoState {
  readonly pullRequests: Map<number, PullRequestState>;
  readonly compares: Map<string, FakeCompare>;
  readonly files: Map<string, RepoFileResult>;
  readonly fileFailures: Map<string, FakeFailure>;
  readonly comments: Map<bigint, string>;
  /** Where a comment sits and who wrote it; a comment seeded without one is on no PR's listing. */
  readonly commentThreads: Map<bigint, FakeCommentThread>;
  readonly branches: Set<string>;
  collaborators: RepoCollaborators;
  /** Keyed by lowercased login. */
  readonly collaboratorPermissions: Map<string, CollaboratorPermission>;
  mentionableUsers: readonly MentionableUser[];
  visibility: RepositoryVisibility;
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
  /** Public when the repository was never arranged. */
  findRepositoryVisibility(repo: RepositoryRef): RepositoryVisibility;
  findInstallation(id: InstallationId): InstallationState | undefined;
  /** The arranged list, else the repos `addInstallation` gave it, else empty. */
  findInstallationRepoIds(id: InstallationId): ReadonlySet<RepoId>;
  isInstallationRemoved(id: InstallationId): boolean;
  /** `undefined` when no teams were arranged for the org. */
  findTeams(org: string): readonly MentionableTeam[] | undefined;
  /** The arranged account by login, any case, in its own casing. */
  findAccountLogin(login: string): string | undefined;
  findFactsHiding(
    ref: PullRequestRef,
    credential: CredentialKind,
  ): FakeFactsHiding | undefined;
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

function getFactsHidingKey(
  ref: PullRequestRef,
  credential: CredentialKind,
): string {
  return `${getRepoKey(ref)}#${ref.prNumber}:${credential}`;
}

function createRepoState(): RepoState {
  return {
    pullRequests: new Map(),
    compares: new Map(),
    files: new Map(),
    fileFailures: new Map(),
    comments: new Map(),
    commentThreads: new Map(),
    branches: new Set(),
    collaborators: { collaborators: [], hasMore: false },
    collaboratorPermissions: new Map(),
    mentionableUsers: [],
    visibility: RepositoryVisibilities.PUBLIC,
  };
}

function createPullRequestState(pull: FakePullRequest): PullRequestState {
  return {
    info: pull.info,
    files: pull.files ?? [],
    diff: pull.diff ?? "",
    conversation: pull.conversation ?? EMPTY_CONVERSATION,
    imageSources: pull.imageSources ?? [],
    videoSources: pull.videoSources ?? [],
    reviews: [...(pull.reviews ?? [])],
    reviewComments: pull.reviewComments ?? { comments: [], complete: true },
    rejectedAnchorPaths: new Set(pull.rejectedAnchorPaths),
  };
}

interface WorldState {
  readonly repos: Map<string, RepoState>;
  readonly repositories: Map<RepoId, RepositoryInfo>;
  readonly issues: Map<string, IssueInfo>;
  readonly installations: Map<InstallationId, InstallationState>;
  readonly installationRepoIds: Map<InstallationId, ReadonlySet<RepoId>>;
  readonly removedInstallations: Set<InstallationId>;
  readonly factsHidings: Map<string, FakeFactsHiding>;
  readonly teams: Map<string, readonly MentionableTeam[]>;
  readonly accounts: Map<string, string>;
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
    updatePullRequest(ref, info) {
      const pull = state.repos
        .get(getRepoKey(ref))
        ?.pullRequests.get(ref.prNumber);
      if (pull === undefined) {
        throw new Error(`no pull request ${ref.prNumber} arranged to update`);
      }
      pull.info = { ...pull.info, ...info };
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
    setRepositoryVisibility(repo, visibility) {
      ensureRepo(state, repo).visibility = visibility;
    },
    addInstallation(installation, repositories) {
      const { installationId } = installation;
      state.installations.set(installationId, { installation, repositories });
    },
    setInstallationRepoIds(installationId, repoIds) {
      state.installationRepoIds.set(installationId, new Set(repoIds));
    },
    removeInstallation(installationId) {
      state.installations.delete(installationId);
      state.removedInstallations.add(installationId);
    },
    addCollaborators(repo, listing) {
      ensureRepo(state, repo).collaborators = listing;
    },
    addCollaboratorPermission(repo, login, permission) {
      const permissions = ensureRepo(state, repo).collaboratorPermissions;
      permissions.set(login.toLowerCase(), permission);
    },
    addMentionableUsers(repo, users) {
      ensureRepo(state, repo).mentionableUsers = users;
      for (const user of users) {
        state.accounts.set(user.login.toLowerCase(), user.login);
      }
    },
    addTeams(org, teams) {
      state.teams.set(org.toLowerCase(), teams);
      state.accounts.set(org.toLowerCase(), org);
    },
    addComment(repo, commentId, body, thread) {
      reserveId(state, "ISSUE_COMMENT", commentId);
      const repoState = ensureRepo(state, repo);
      repoState.comments.set(commentId, body);
      if (thread !== undefined) {
        repoState.commentThreads.set(commentId, thread);
      }
    },
    removeComment(repo, commentId) {
      ensureRepo(state, repo).comments.delete(commentId);
    },
    addBranch(repo, branch) {
      ensureRepo(state, repo).branches.add(branch);
    },
    failRepoFile(repo, file, failure) {
      const key = getFileKey(file.path, file.ref);
      ensureRepo(state, repo).fileFailures.set(key, failure);
    },
    hideFacts(ref, credential, hiding) {
      state.factsHidings.set(getFactsHidingKey(ref, credential), hiding);
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
    findRepositoryVisibility(repo) {
      const arranged = state.repos.get(getRepoKey(repo))?.visibility;
      return arranged ?? RepositoryVisibilities.PUBLIC;
    },
    findInstallation(id) {
      return state.installations.get(id);
    },
    findInstallationRepoIds(id) {
      const arranged = state.installationRepoIds.get(id);
      if (arranged !== undefined) {
        return arranged;
      }
      const repositories = state.installations.get(id)?.repositories;
      return new Set(repositories?.keys());
    },
    isInstallationRemoved(id) {
      return state.removedInstallations.has(id);
    },
    findTeams(org) {
      return state.teams.get(org.toLowerCase());
    },
    findAccountLogin(login) {
      return state.accounts.get(login.toLowerCase());
    },
    findFactsHiding(ref, credential) {
      return state.factsHidings.get(getFactsHidingKey(ref, credential));
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
    installationRepoIds: new Map(),
    removedInstallations: new Set(),
    factsHidings: new Map(),
    teams: new Map(),
    accounts: new Map(),
    nextIds: { ...FIRST_IDS },
  };
  return { ...buildArrange(state), ...buildLookups(state) };
}
