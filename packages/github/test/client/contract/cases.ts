import type {
  GitHubReader,
  InstallationGitHub,
  InstallationRepoClient,
  RepoReader,
  ReviewerGitHub,
  ReviewerRepoClient,
} from "../../../src/client/types";
import { ReviewCommentSides } from "types/conversation";
import { ReviewSubjectTypes } from "../../../src/operations/review-thread";
import { MentionTargetKinds } from "../../../src/operations/mentions/types";
import { ReviewEvents } from "../../../src/operations/review-submit";
import { InstallationPresences } from "../../../src/operations/installation/types";
import { CollaboratorPermissions } from "../../../src/operations/collaborator-permission/types";
import { requireInstallationId, requireRepoId } from "../helpers";
import {
  ATTACHMENT_COMMIT_SHA,
  BASE_SHA,
  DIFF,
  HEAD_SHA,
  REPO_FILE_MAX_BYTES,
} from "./consts";
import type {
  ContractAppReader,
  ContractCase,
  TypedContractCase,
} from "./types";

export function defineCase<Client, Value>(
  typed: TypedContractCase<Client, Value>,
): ContractCase<Client> {
  return typed;
}

const UPDATED_AT = new Date("2026-10-01T10:00:00Z");

export const REPO_READER_CASES: readonly ContractCase<RepoReader>[] = [
  defineCase({
    operation: "fetchPullRequest",
    operatorReach: true,
    call: (client: RepoReader) => client.fetchPullRequest(7),
    expected: {
      repoId: requireRepoId(4242n),
      repoFullName: "acme/widgets",
      headSha: HEAD_SHA,
      headRef: "feature",
      baseSha: BASE_SHA,
      baseRef: "main",
      state: "open",
      draft: false,
      merged: false,
      title: "Add widgets",
      body: "",
      htmlUrl: "https://github.com/acme/widgets/pull/7",
      commitCount: 2,
      authorLogin: "octocat",
      closedAt: null,
      updatedAt: UPDATED_AT,
      baseRepo: { owner: "acme", repo: "widgets" },
    },
  }),
  defineCase({
    operation: "fetchPullRequestFiles",
    operatorReach: true,
    call: (client: RepoReader) => client.fetchPullRequestFiles(7),
    expected: [{ path: "src/a.ts", additions: 3, deletions: 1 }],
  }),
  defineCase({
    operation: "fetchDiff",
    operatorReach: true,
    call: (client: RepoReader) => client.fetchDiff(7),
    expected: DIFF,
  }),
  defineCase({
    operation: "fetchCompareDiff",
    operatorReach: true,
    call: (client: RepoReader) =>
      client.fetchCompareDiff({ base: BASE_SHA, head: HEAD_SHA }),
    expected: DIFF,
  }),
  defineCase({
    operation: "fetchCompareFiles",
    operatorReach: true,
    call: (client: RepoReader) =>
      client.fetchCompareFiles({ base: BASE_SHA, head: HEAD_SHA }),
    expected: {
      files: [{ filename: "src/a.ts", status: "modified" }],
      complete: true,
      status: "ahead",
    },
  }),
  defineCase({
    operation: "fetchRepoFile",
    operatorReach: true,
    call: (client: RepoReader) =>
      client.fetchRepoFile({
        path: ".mergebrief.yml",
        ref: HEAD_SHA,
        maxBytes: REPO_FILE_MAX_BYTES,
      }),
    expected: {
      kind: "file",
      content: "hello",
      blobSha: "f".repeat(40),
      size: 5,
    },
    notFound: { kind: "absent" },
  }),
  defineCase({
    operation: "fetchPullRequestConversation",
    operatorReach: true,
    call: (client: RepoReader) => client.fetchPullRequestConversation(7),
    expected: {
      threads: [],
      reviews: [],
      prComments: [],
      hasMoreThreads: false,
      hasMoreReviews: false,
      hasMorePrComments: false,
    },
  }),
  defineCase({
    operation: "fetchRenderedImageSources",
    operatorReach: true,
    call: (client: RepoReader) => client.fetchRenderedImageSources(7),
    expected: ["https://images.example/1.png"],
  }),
];

export const ACCOUNT_READER_CASES: readonly ContractCase<GitHubReader>[] = [
  defineCase({
    operation: "fetchRepositoryById",
    call: (client: GitHubReader) =>
      client.fetchRepositoryById(requireRepoId(4242n)),
    expected: {
      repoId: requireRepoId(4242n),
      fullName: "acme/widgets",
      private: true,
      viewerCanPush: true,
      viewerIsAdmin: false,
    },
  }),
  defineCase({
    operation: "readPullRequestFacts",
    call: (client: GitHubReader) =>
      client.readPullRequestFacts([
        { owner: "acme", repo: "widgets", prNumber: 7 },
      ]),
    expected: new Map([
      [
        "acme/widgets#7",
        {
          repoId: requireRepoId(4242n),
          repoFullName: "acme/widgets",
          state: "open",
          merged: false,
          draft: false,
          title: "Add widgets",
          closedAt: null,
          updatedAt: UPDATED_AT,
          headSha: HEAD_SHA,
          authorLogin: "octocat",
        },
      ],
    ]),
  }),
  defineCase({
    operation: "fetchIssue",
    call: (client: GitHubReader) =>
      client.fetchIssue({ owner: "acme", repo: "tickets", number: 12 }),
    expected: {
      title: "Ship widgets",
      state: "open",
      stateReason: null,
      labels: ["feature"],
      milestone: null,
      body: "Details",
      isPullRequest: false,
    },
  }),
];

export const INSTALLATION_ACCOUNT_CASES: readonly ContractCase<InstallationGitHub>[] =
  [
    defineCase({
      operation: "listInstallationRepoIds",
      call: (client: InstallationGitHub) => client.listInstallationRepoIds(),
      expected: new Set([requireRepoId(4242n)]),
    }),
  ];

export const APP_CASES: readonly ContractCase<ContractAppReader>[] = [
  defineCase({
    operation: "readInstallationPresence",
    call: (client: ContractAppReader) =>
      client.readInstallationPresence(requireInstallationId(99n)),
    expected: InstallationPresences.PRESENT,
    notFound: InstallationPresences.GONE,
  }),
];

export const REVIEWER_ACCOUNT_CASES: readonly ContractCase<ReviewerGitHub>[] = [
  defineCase({
    operation: "listUserInstallations",
    call: (client: ReviewerGitHub) => client.listUserInstallations(),
    expected: [
      { installationId: requireInstallationId(99n), accountLogin: "acme" },
    ],
  }),
  defineCase({
    operation: "listInstallationRepositories",
    call: (client: ReviewerGitHub) =>
      client.listInstallationRepositories(requireInstallationId(99n)),
    expected: new Map([
      [requireRepoId(4242n), { fullName: "acme/widgets", viewerIsAdmin: true }],
    ]),
  }),
];

const OPEN_PULL_REQUESTS = defineCase({
  operation: "listOpenPullRequests",
  call: (client: ReviewerRepoClient | InstallationRepoClient) =>
    client.listOpenPullRequests(),
  expected: [
    {
      number: 7,
      title: "Add widgets",
      headRef: "feature",
      baseRef: "main",
      headRepo: { owner: "acme", repo: "widgets" },
      baseRepo: { owner: "acme", repo: "widgets" },
    },
  ],
});

const REVIEWER_READ_CASES: readonly ContractCase<ReviewerRepoClient>[] = [
  OPEN_PULL_REQUESTS,
  defineCase({
    operation: "findPendingPullRequestReview",
    call: (client: ReviewerRepoClient) =>
      client.findPendingPullRequestReview(7),
    expected: { reviewId: 77n, reviewNodeId: "PRR_77" },
  }),
  defineCase({
    operation: "countPendingReviewComments",
    call: (client: ReviewerRepoClient) =>
      client.countPendingReviewComments("PRR_77"),
    expected: 2,
  }),
  defineCase({
    operation: "hasPullRequestReviewPublished",
    call: (client: ReviewerRepoClient) =>
      client.hasPullRequestReviewPublished({ prNumber: 7, reviewId: 78n }),
    expected: true,
  }),
  defineCase({
    operation: "listReviewsByAuthor",
    call: (client: ReviewerRepoClient) =>
      client.listReviewsByAuthor({ prNumber: 7, authorId: 501n }),
    expected: [
      { reviewId: 77n, state: "PENDING", body: "" },
      {
        reviewId: 78n,
        state: "COMMENTED",
        body: "Looks fine",
        submittedAt: UPDATED_AT,
      },
    ],
  }),
  defineCase({
    operation: "listReviewCommentsSince",
    call: (client: ReviewerRepoClient) =>
      client.listReviewCommentsSince({
        prNumber: 7,
        since: new Date("2026-10-01T00:00:00Z"),
      }),
    expected: {
      comments: [
        {
          commentId: 901n,
          reviewId: 78n,
          authorId: 501n,
          path: "src/a.ts",
          body: "why",
          subjectType: "line",
          line: 3,
          originalLine: 3,
          side: "RIGHT",
        },
      ],
      complete: true,
    },
  }),
  defineCase({
    operation: "searchMentionableUsers",
    call: (client: ReviewerRepoClient) => client.searchMentionableUsers("ca"),
    expected: [
      {
        login: "cara",
        name: "Cara Example",
        avatarUrl: "https://avatars.example/cara.png",
      },
    ],
  }),
  defineCase({
    operation: "searchMentionableTeams",
    call: (client: ReviewerRepoClient) => client.searchMentionableTeams("back"),
    expected: [{ combinedSlug: "acme/backend", name: "Backend" }],
  }),
  defineCase({
    operation: "resolveMentionTargets",
    call: (client: ReviewerRepoClient) =>
      client.resolveMentionTargets([
        { kind: MentionTargetKinds.USER, login: "Cara" },
        { kind: MentionTargetKinds.USER, login: "nobody" },
        { kind: MentionTargetKinds.TEAM, org: "acme", slug: "backend" },
      ]),
    expected: { users: ["cara"], teams: ["acme/backend"] },
  }),
];

const REVIEWER_WRITE_CASES: readonly ContractCase<ReviewerRepoClient>[] = [
  defineCase({
    operation: "createPullRequestReview",
    call: (client: ReviewerRepoClient) =>
      client.createPullRequestReview({ prNumber: 7, commitId: HEAD_SHA }),
    expected: { reviewId: 77n, reviewNodeId: "PRR_77" },
    create: true,
  }),
  defineCase({
    operation: "addPullRequestReviewThread",
    call: (client: ReviewerRepoClient) =>
      client.addPullRequestReviewThread({
        reviewNodeId: "PRR_77",
        subjectType: ReviewSubjectTypes.FILE,
        path: "src/a.ts",
        body: "why",
      }),
    expected: { threadId: "PRRT_1" },
    create: true,
  }),
  defineCase({
    operation: "submitPullRequestReview",
    call: (client: ReviewerRepoClient) =>
      client.submitPullRequestReview({
        reviewNodeId: "PRR_77",
        event: ReviewEvents.COMMENT,
        body: "done",
      }),
    expected: undefined,
    create: true,
  }),
  defineCase({
    operation: "createInlineReviewComment",
    call: (client: ReviewerRepoClient) =>
      client.createInlineReviewComment({
        prNumber: 7,
        commitId: HEAD_SHA,
        path: "src/a.ts",
        line: 3,
        side: ReviewCommentSides.RIGHT,
        body: "why",
      }),
    expected: { commentId: 901n, reviewId: 77n },
    create: true,
  }),
  defineCase({
    operation: "createReviewCommentReply",
    call: (client: ReviewerRepoClient) =>
      client.createReviewCommentReply({
        prNumber: 7,
        commentId: 901,
        body: "agreed",
      }),
    expected: { commentId: 902, reviewId: 78 },
    create: true,
  }),
  defineCase({
    operation: "markPullRequestReadyForReview",
    call: (client: ReviewerRepoClient) =>
      client.markPullRequestReadyForReview(7),
    expected: { alreadyReady: false },
  }),
  defineCase({
    operation: "setReviewThreadResolution",
    call: (client: ReviewerRepoClient) =>
      client.setReviewThreadResolution({
        prNumber: 7,
        rootCommentId: 901,
        resolved: true,
      }),
    expected: { alreadyInTargetState: false },
  }),
  defineCase({
    operation: "deletePendingPullRequestReview",
    call: (client: ReviewerRepoClient) =>
      client.deletePendingPullRequestReview({ prNumber: 7, reviewId: 77n }),
    expected: undefined,
    notFound: undefined,
  }),
];

export const REVIEWER_REPO_CASES: readonly ContractCase<ReviewerRepoClient>[] =
  [...REVIEWER_READ_CASES, ...REVIEWER_WRITE_CASES];

export const INSTALLATION_REPO_CASES: readonly ContractCase<InstallationRepoClient>[] =
  [
    OPEN_PULL_REQUESTS,
    defineCase({
      operation: "listRepoCollaborators",
      call: (client: InstallationRepoClient) => client.listRepoCollaborators(),
      expected: {
        collaborators: [
          {
            login: "bob",
            name: "Bob Example",
            avatarUrl: "https://avatars.example/bob.png",
          },
        ],
        hasMore: false,
      },
    }),
    defineCase({
      operation: "readCollaboratorPermission",
      call: (client: InstallationRepoClient) =>
        client.readCollaboratorPermission("bob"),
      expected: CollaboratorPermissions.WRITE,
    }),
    defineCase({
      operation: "fetchComment",
      call: (client: InstallationRepoClient) => client.fetchComment(1001n),
      expected: { body: "Entry" },
      notFound: undefined,
    }),
    defineCase({
      operation: "postEntryComment",
      call: (client: InstallationRepoClient) =>
        client.postEntryComment({ prNumber: 7, body: "Entry" }),
      expected: { commentId: 1001n },
    }),
    defineCase({
      operation: "deleteComment",
      call: (client: InstallationRepoClient) => client.deleteComment(1001n),
      expected: undefined,
      notFound: undefined,
    }),
    defineCase({
      operation: "commitAttachment",
      call: (client: InstallationRepoClient) =>
        client.commitAttachment({
          branch: "mergebrief/attachments",
          path: "0b7e.png",
          bytes: new Uint8Array([1, 2, 3]),
        }),
      expected: { commitSha: ATTACHMENT_COMMIT_SHA },
    }),
    defineCase({
      operation: "deleteAttachmentBranch",
      call: (client: InstallationRepoClient) =>
        client.deleteAttachmentBranch("mergebrief/attachments"),
      expected: { existed: true },
    }),
  ];
