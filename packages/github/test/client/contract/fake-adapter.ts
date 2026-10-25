import type { Mutable } from "types/utils";
import type {
  OperatorReads,
  ReviewerBindingOptions,
  ReviewerCredential,
  ReviewerGitHub,
} from "../../../src/client/types";
import { CollaboratorPermissions } from "../../../src/operations/collaborator-permission/types";
import type { PrConversation } from "../../../src/operations/conversation";
import type { ReviewCommentListing } from "../../../src/operations/review-comment-list";
import { FAKE_APP_BOT_USER_ID, makeFakeGitHub } from "../../../src/testing";
import {
  CredentialKinds,
  FakeFailures,
  type FakeFailure,
  type FakeGitHub,
  type FakeReview,
  type GitHubOperation,
} from "../../../src/testing/types";
import {
  REPO,
  makeLogger,
  requireInstallationId,
  requireRepoId,
  stubCredential,
} from "../helpers";
import {
  BASE_SHA,
  DIFF,
  HEAD_SHA,
  OPERATOR_READS,
  REVIEWER_TOKEN,
} from "./consts";
import {
  ContractOutcomes,
  type ContractAdapter,
  type ContractArrangement,
  type ContractOutcome,
} from "./types";

const PR = { ...REPO, prNumber: 7 };
const REPO_ID = requireRepoId(4242n);
const UPDATED_AT = new Date("2026-10-01T10:00:00Z");
const AUTHOR_ID = 501n;

const EMPTY_CONVERSATION: PrConversation = {
  threads: [],
  reviews: [],
  prComments: [],
  hasMoreThreads: false,
  hasMoreReviews: false,
  hasMorePrComments: false,
};

const UNRESOLVED_THREAD_CONVERSATION: PrConversation = {
  ...EMPTY_CONVERSATION,
  threads: [
    {
      rootCommentId: 901,
      path: "src/a.ts",
      subjectType: "LINE",
      isResolved: false,
      isOutdated: false,
      comments: [],
      hasMoreComments: false,
    },
  ],
};

const PENDING_REVIEW: FakeReview = {
  reviewId: 77n,
  reviewNodeId: "PRR_77",
  state: "PENDING",
  body: "",
  authorId: AUTHOR_ID,
  commentCount: 2,
};

const PUBLISHED_REVIEW: FakeReview = {
  reviewId: 78n,
  reviewNodeId: "PRR_78",
  state: "COMMENTED",
  body: "Looks fine",
  authorId: AUTHOR_ID,
  submittedAt: UPDATED_AT,
};

function listReviewComments(reviewId: bigint): ReviewCommentListing {
  return {
    comments: [
      {
        commentId: 901n,
        reviewId,
        authorId: AUTHOR_ID,
        path: "src/a.ts",
        body: "why",
        subjectType: "line",
        line: 3,
        originalLine: 3,
        side: "RIGHT",
      },
    ],
    complete: true,
  };
}

interface ReviewHistory {
  readonly reviews: readonly FakeReview[];
  readonly reviewComments: ReviewCommentListing;
}

const NO_HISTORY: ReviewHistory = {
  reviews: [],
  reviewComments: { comments: [], complete: true },
};

/** A create allocates the next id, so the history before it fixes the answer. */
const HISTORY_BEFORE: Partial<Record<GitHubOperation, ReviewHistory>> = {
  createPullRequestReview: NO_HISTORY,
  createInlineReviewComment: NO_HISTORY,
  createReviewCommentReply: {
    reviews: [{ ...PUBLISHED_REVIEW, reviewId: 77n, reviewNodeId: "PRR_77" }],
    reviewComments: listReviewComments(77n),
  },
};

const DEFAULT_HISTORY: ReviewHistory = {
  reviews: [PENDING_REVIEW, PUBLISHED_REVIEW],
  reviewComments: listReviewComments(78n),
};

function arrangePullRequest(
  github: FakeGitHub,
  operation: GitHubOperation,
): void {
  const history = HISTORY_BEFORE[operation] ?? DEFAULT_HISTORY;
  const resolving = operation === "setReviewThreadResolution";

  github.addPullRequest(PR, {
    info: {
      repoId: REPO_ID,
      repoFullName: "acme/widgets",
      headSha: HEAD_SHA,
      headRef: "feature",
      baseSha: BASE_SHA,
      baseRef: "main",
      state: "open",
      draft: operation === "markPullRequestReadyForReview",
      merged: false,
      title: "Add widgets",
      body: "",
      htmlUrl: "https://github.com/acme/widgets/pull/7",
      commitCount: 2,
      authorLogin: "octocat",
      authorIsBot: false,
      closedAt: null,
      updatedAt: UPDATED_AT,
      baseRepo: { owner: "acme", repo: "widgets" },
    },
    files: [{ path: "src/a.ts", additions: 3, deletions: 1 }],
    diff: DIFF,
    conversation: resolving
      ? UNRESOLVED_THREAD_CONVERSATION
      : EMPTY_CONVERSATION,
    imageSources: ["https://images.example/1.png"],
    ...history,
  });
}

function arrangeRepository(github: FakeGitHub, operation: GitHubOperation) {
  github.addRepository({
    repoId: REPO_ID,
    fullName: "acme/widgets",
    private: true,
    viewerCanPush: true,
    viewerIsAdmin: false,
  });
  github.addCompare(
    REPO,
    { base: BASE_SHA, head: HEAD_SHA },
    {
      diff: DIFF,
      files: {
        files: [{ filename: "src/a.ts", status: "modified" }],
        complete: true,
        status: "ahead",
      },
    },
  );
  github.addRepoFile(
    REPO,
    { path: ".mergebrief.yml", ref: HEAD_SHA },
    { kind: "file", content: "hello", blobSha: "f".repeat(40), size: 5 },
  );
  github.addCollaborators(REPO, {
    collaborators: [
      {
        login: "bob",
        name: "Bob Example",
        avatarUrl: "https://avatars.example/bob.png",
      },
    ],
    hasMore: false,
  });
  github.addCollaboratorPermission(REPO, "bob", CollaboratorPermissions.WRITE);
  github.addMentionableUsers(REPO, [
    {
      login: "bob",
      name: "Bob Example",
      avatarUrl: "https://avatars.example/bob.png",
    },
    {
      login: "cara",
      name: "Cara Example",
      avatarUrl: "https://avatars.example/cara.png",
    },
  ]);
  github.addTeams("acme", [
    { combinedSlug: "acme/backend", name: "Backend" },
    { combinedSlug: "acme/frontend", name: "Frontend" },
  ]);
  if (operation !== "postEntryComment") {
    github.addComment(REPO, 1001n, "Entry", {
      prNumber: 7,
      authorId: FAKE_APP_BOT_USER_ID,
    });
  }
  github.addBranch(REPO, "mergebrief/attachments");
}

function arrangeAccount(github: FakeGitHub): void {
  github.addIssue(
    { owner: "acme", repo: "tickets", number: 12 },
    {
      title: "Ship widgets",
      state: "open",
      stateReason: null,
      labels: ["feature"],
      milestone: null,
      body: "Details",
      isPullRequest: false,
    },
  );
  github.addInstallation(
    { installationId: requireInstallationId(99n), accountLogin: "acme" },
    new Map([[REPO_ID, { fullName: "acme/widgets", viewerIsAdmin: true }]]),
  );
  github.setInstallationRepoIds(requireInstallationId(99n), [REPO_ID]);
}

const FAILURES: Readonly<
  Record<Exclude<ContractOutcome, typeof ContractOutcomes.OK>, FakeFailure>
> = {
  [ContractOutcomes.NOT_FOUND]: FakeFailures.NOT_FOUND,
  [ContractOutcomes.FORBIDDEN]: FakeFailures.FORBIDDEN,
  [ContractOutcomes.UNAUTHORIZED]: FakeFailures.UNAUTHORIZED,
  [ContractOutcomes.SERVER_ERROR]: FakeFailures.SERVER_ERROR,
};

function arrangeOutcome(
  github: FakeGitHub,
  { operation, outcome, reviewerOutcome }: ContractArrangement,
): void {
  if (outcome !== ContractOutcomes.OK) {
    github.failOn(operation, FAILURES[outcome]);
  }
  if (reviewerOutcome === ContractOutcomes.UNAUTHORIZED) {
    github.rejectToken(REVIEWER_TOKEN);
    return;
  }
  if (
    reviewerOutcome !== undefined &&
    reviewerOutcome !== ContractOutcomes.OK
  ) {
    github.failOn(
      operation,
      FAILURES[reviewerOutcome],
      CredentialKinds.REVIEWER,
    );
  }
}

/** The fake's bindings over a world in which every case's answer holds. */
export function createFakeAdapter(
  arrangement: ContractArrangement,
): ContractAdapter {
  const github = makeFakeGitHub();
  arrangePullRequest(github, arrangement.operation);
  arrangeRepository(github, arrangement.operation);
  arrangeAccount(github);
  arrangeOutcome(github, arrangement);
  if (arrangement.mintRefused === true) {
    github.removeInstallation(requireInstallationId(99n));
  }

  function bindReviewer(
    credential: ReviewerCredential,
    operatorReads?: OperatorReads,
  ): ReviewerGitHub {
    const options: Mutable<ReviewerBindingOptions> = { log: makeLogger() };
    if (operatorReads !== undefined) {
      options.operatorReads = operatorReads;
    }
    return github.bindReviewerGitHub(credential, options);
  }

  return {
    reviewer: bindReviewer(stubCredential(REVIEWER_TOKEN, undefined)),
    installation: github.bindInstallationGitHub(requireInstallationId(99n)),
    operator: github.bindOperatorGitHub(OPERATOR_READS.token),
    app: {
      readInstallationPresence: (installationId) =>
        github.readInstallationPresence(installationId),
    },
    bindReviewer,
    countRequests() {
      return github.calls.length;
    },
  };
}
