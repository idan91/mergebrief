import { bindInstallationGitHub } from "../../../src/client/installation";
import { readInstallationPresence } from "../../../src/operations/installation";
import { bindOperatorGitHub } from "../../../src/client/operator";
import { bindReviewerGitHub } from "../../../src/client/reviewer";
import {
  collaboratorsResponse,
  gqlCollaborator,
} from "../../fixtures/collaborators-graphql";
import type { Mutable } from "types/utils";
import type {
  OperatorReads,
  ReviewerBindingOptions,
  ReviewerCredential,
  ReviewerGitHub,
} from "../../../src/client/types";
import { FAKE_APP_BOT_USER_ID } from "../../../src/testing/consts";
import type { GitHubOperation } from "../../../src/testing/types";
import {
  MINT_OK,
  MINT_PATH,
  formatTokenAuthorization,
  makeApp,
  makeLogger,
  makeOctokitFactory,
  makePullRequestBody,
  makeRepositoryBody,
  requireInstallationId,
  stubCredential,
  stubGitHubFetch,
  type RouteHandler,
  type StubResponse,
} from "../helpers";
import {
  ATTACHMENT_COMMIT_SHA,
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

const REVIEW_LIST = [
  { id: 77, node_id: "PRR_77", state: "PENDING", body: "", user: { id: 501 } },
  {
    id: 78,
    node_id: "PRR_78",
    state: "COMMENTED",
    body: "Looks fine",
    user: { id: 501 },
    commit_id: HEAD_SHA,
    submitted_at: "2026-10-01T10:00:00Z",
  },
];

const OPEN_PULL = {
  number: 7,
  title: "Add widgets",
  head: { ref: "feature", repo: { name: "widgets", owner: { login: "acme" } } },
  base: { ref: "main", repo: { name: "widgets", owner: { login: "acme" } } },
};

function answerOk(body: unknown): StubResponse {
  return { status: 200, body };
}

function answerGraphql(data: unknown): StubResponse {
  return { status: 200, body: { data } };
}

const LIVE_READ_REPOSITORY = {
  databaseId: 4242,
  nameWithOwner: "acme/widgets",
  pullRequest: {
    state: "OPEN",
    isDraft: false,
    title: "Add widgets",
    closedAt: null,
    updatedAt: "2026-10-01T10:00:00Z",
    createdAt: "2026-09-01T08:00:00Z",
    headRefOid: HEAD_SHA,
    author: { login: "octocat" },
  },
};

const EMPTY_PAGE = { pageInfo: { hasNextPage: false }, nodes: [] };

const RESOLVABLE_THREAD = {
  id: "PRRT_1",
  isResolved: false,
  comments: { nodes: [{ fullDatabaseId: "901" }] },
};

/** GitHub's wire answer for each operation the contract arranges. */
const OK_ANSWERS: Readonly<Record<GitHubOperation, StubResponse>> = {
  fetchPullRequest: answerOk(makePullRequestBody(7)),
  fetchPullRequestFiles: answerOk([
    { filename: "src/a.ts", additions: 3, deletions: 1 },
  ]),
  fetchDiff: answerOk(DIFF),
  fetchCompareDiff: answerOk(DIFF),
  fetchCheckedCompareDiff: answerOk(DIFF),
  fetchMergeBase: answerOk({ merge_base_commit: { sha: BASE_SHA } }),
  fetchRepoFile: answerOk({
    type: "file",
    size: 5,
    sha: "f".repeat(40),
    content: Buffer.from("hello").toString("base64"),
    encoding: "base64",
  }),
  fetchPullRequestConversation: answerGraphql({
    repository: {
      pullRequest: {
        reviewThreads: {
          pageInfo: { hasNextPage: false, endCursor: null },
          nodes: [],
        },
        reviews: EMPTY_PAGE,
        comments: EMPTY_PAGE,
      },
    },
  }),
  fetchRenderedMediaSources: answerGraphql({
    repository: {
      pullRequest: {
        bodyHTML:
          '<p><img alt="x" src="https://images.example/1.png"></p><video src="https://videos.example/1.mp4" controls></video>',
        comments: { nodes: [] },
        reviews: { nodes: [] },
        reviewThreads: { nodes: [] },
      },
    },
  }),
  fetchRepositoryById: answerOk(makeRepositoryBody("acme/widgets")),
  readPullRequestFacts: answerGraphql({ p0: LIVE_READ_REPOSITORY }),
  fetchIssue: answerOk({
    title: "Ship widgets",
    state: "open",
    state_reason: null,
    labels: [{ name: "feature" }],
    milestone: null,
    body: "Details",
  }),
  fetchRepositoryVisibility: answerOk({
    full_name: "acme/tickets",
    private: true,
    visibility: "private",
  }),
  listUserInstallations: answerOk({
    total_count: 1,
    installations: [{ id: 99, account: { login: "acme" } }],
  }),
  listInstallationRepositories: answerOk({
    total_count: 1,
    repositories: [
      { id: 4242, full_name: "acme/widgets", permissions: { admin: true } },
    ],
  }),
  listInstallationRepoIds: answerOk({
    total_count: 1,
    repositories: [{ id: 4242 }],
  }),
  readInstallationPresence: answerOk({ id: 99, account: { login: "acme" } }),
  listOpenPullRequests: answerOk([OPEN_PULL]),
  findPendingPullRequestReview: answerOk(REVIEW_LIST),
  countPendingReviewComments: answerGraphql({
    node: { comments: { totalCount: 2 } },
  }),
  hasPullRequestReviewPublished: answerOk(REVIEW_LIST),
  listReviewsByAuthor: answerOk(REVIEW_LIST),
  listReviewCommentsSince: answerOk([
    {
      id: 901,
      pull_request_review_id: 78,
      user: { id: 501 },
      path: "src/a.ts",
      body: "why",
      subject_type: "line",
      line: 3,
      original_line: 3,
      side: "RIGHT",
    },
  ]),
  searchMentionableUsers: answerGraphql({
    repository: {
      mentionableUsers: {
        nodes: [
          {
            login: "cara",
            name: "Cara Example",
            avatarUrl: "https://avatars.example/cara.png",
          },
        ],
      },
    },
  }),
  searchMentionableTeams: answerGraphql({
    organization: {
      teams: { nodes: [{ combinedSlug: "acme/backend", name: "Backend" }] },
    },
  }),
  resolveMentionTargets: answerGraphql({
    u0: { login: "cara" },
    u1: null,
    t2: { team: { combinedSlug: "acme/backend" } },
  }),
  createPullRequestReview: answerOk({ id: 77, node_id: "PRR_77" }),
  addPullRequestReviewThread: answerGraphql({
    addPullRequestReviewThread: { thread: { id: "PRRT_1" } },
  }),
  submitPullRequestReview: answerGraphql({
    submitPullRequestReview: { pullRequestReview: { id: "PRR_77" } },
  }),
  createInlineReviewComment: answerOk({ id: 901, pull_request_review_id: 77 }),
  createReviewCommentReply: answerOk({ id: 902, pull_request_review_id: 78 }),
  // One payload answers both the node-id read and the mutation.
  markPullRequestReadyForReview: answerGraphql({
    repository: {
      pullRequest: {
        id: "PR_7",
        isDraft: true,
        updatedAt: "2026-10-01T10:00:00Z",
      },
    },
    markPullRequestReadyForReview: {
      pullRequest: { isDraft: false, updatedAt: "2026-10-01T10:00:00Z" },
    },
  }),
  setReviewThreadResolution: answerGraphql({
    repository: {
      pullRequest: {
        reviewThreads: {
          pageInfo: { hasNextPage: false, endCursor: null },
          nodes: [RESOLVABLE_THREAD],
        },
      },
    },
    resolveReviewThread: { thread: { isResolved: true } },
  }),
  deletePendingPullRequestReview: answerOk({ id: 77 }),
  listRepoCollaborators: answerGraphql(
    collaboratorsResponse({
      nodes: [gqlCollaborator({ login: "bob", name: "Bob Example" })],
    }),
  ),
  readCollaboratorPermission: answerOk({
    permission: "write",
    role_name: "maintain",
    user: { login: "bob" },
  }),
  fetchComment: answerOk({ id: 1001, body: "Entry" }),
  listIssueComments: answerOk([
    { id: 1001, body: "Entry", user: { id: Number(FAKE_APP_BOT_USER_ID) } },
  ]),
  postEntryComment: answerOk({ id: 1001 }),
  deleteComment: answerOk({}),
  editComment: answerOk({ id: 1001, body: "Entry, edited" }),
  // Every git-data step of the commit reads the field it needs from this one
  // body: the blob, tree and commit `sha`, the ref's `object`, the `tree`.
  commitAttachment: {
    status: 201,
    body: {
      sha: ATTACHMENT_COMMIT_SHA,
      object: { sha: "d".repeat(40) },
      tree: { sha: "e".repeat(40) },
    },
  },
  deleteAttachmentBranch: answerOk({}),
  listCheckRuns: answerOk({
    total_count: 1,
    check_runs: [
      {
        id: 4001,
        name: "CodeRabbit",
        status: "completed",
        conclusion: "success",
        app: { id: 347564 },
        output: { title: "Finished", text: null },
      },
    ],
  }),
  listCommitStatuses: answerOk([
    {
      context: "Unblocked Review",
      state: "success",
      creator: { id: 98133410 },
    },
  ]),
  listSubmittedReviews: answerOk(REVIEW_LIST),
  listRequiredStatusChecks: answerOk([
    {
      type: "required_status_checks",
      parameters: {
        strict_required_status_checks_policy: false,
        required_status_checks: [{ context: "build", integration_id: 15368 }],
      },
    },
    { type: "deletion" },
  ]),
};

const FAILURE_ANSWERS: Readonly<
  Record<Exclude<ContractOutcome, typeof ContractOutcomes.OK>, StubResponse>
> = {
  [ContractOutcomes.NOT_FOUND]: { status: 404, body: { message: "Not Found" } },
  [ContractOutcomes.FORBIDDEN]: { status: 403, body: { message: "Forbidden" } },
  [ContractOutcomes.UNAUTHORIZED]: {
    status: 401,
    body: { message: "Bad credentials" },
  },
  [ContractOutcomes.SERVER_ERROR]: {
    status: 502,
    body: { message: "Bad Gateway" },
  },
};

function selectAnswer(
  operation: GitHubOperation,
  outcome: ContractOutcome,
): StubResponse {
  if (outcome === ContractOutcomes.OK) {
    return OK_ANSWERS[operation];
  }
  return FAILURE_ANSWERS[outcome];
}

const MINT_REFUSED = { status: 404, body: { message: "Not Found" } };

/** The reviewer's token gets `reviewerOutcome`; every other credential `outcome`. */
function routeArrangement(arrangement: ContractArrangement): RouteHandler {
  const { operation, outcome } = arrangement;
  const answer = selectAnswer(operation, outcome);
  const reviewerAnswer = selectAnswer(
    operation,
    arrangement.reviewerOutcome ?? outcome,
  );
  const reviewerAuthorization = formatTokenAuthorization(REVIEWER_TOKEN);

  return (request) => {
    if (request.path === MINT_PATH) {
      return arrangement.mintRefused === true ? MINT_REFUSED : MINT_OK;
    }
    if (request.authorization === reviewerAuthorization) {
      return reviewerAnswer;
    }
    return answer;
  };
}

/** The production bindings over a stubbed fetch that answers `arrangement`. */
export function createOctokitAdapter(
  arrangement: ContractArrangement,
): ContractAdapter {
  const stub = stubGitHubFetch(routeArrangement(arrangement));
  const octokitFactory = makeOctokitFactory(stub);
  const app = makeApp(stub);

  function bindReviewer(
    credential: ReviewerCredential,
    operatorReads?: OperatorReads,
  ): ReviewerGitHub {
    const options: Mutable<ReviewerBindingOptions> = {
      log: makeLogger(),
      octokitFactory,
    };
    if (operatorReads !== undefined) {
      options.operatorReads = operatorReads;
    }
    return bindReviewerGitHub(credential, options);
  }

  return {
    reviewer: bindReviewer(stubCredential(REVIEWER_TOKEN, undefined)),
    installation: bindInstallationGitHub(app, requireInstallationId(99n)),
    operator: bindOperatorGitHub(OPERATOR_READS.token, { octokitFactory }),
    app: {
      readInstallationPresence: (installationId) =>
        readInstallationPresence(app, installationId),
    },
    bindReviewer,
    countRequests() {
      return stub.requests.filter((request) => request.path !== MINT_PATH)
        .length;
    },
  };
}
