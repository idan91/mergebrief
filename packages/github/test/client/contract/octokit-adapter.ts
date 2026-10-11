import { bindInstallationGitHub } from "../../../src/client/installation";
import { bindOperatorGitHub } from "../../../src/client/operator";
import { bindReviewerGitHub } from "../../../src/client/reviewer";
import {
  collaboratorsResponse,
  gqlCollaborator,
} from "../../fixtures/collaborators-graphql";
import {
  MINT_OK,
  MINT_PATH,
  makeApp,
  makeLogger,
  makeOctokitFactory,
  makePullRequestBody,
  makeRepositoryBody,
  requireInstallationId,
  requireOperatorToken,
  routeMinting,
  stubCredential,
  stubGitHubFetch,
  type StubResponse,
} from "../helpers";
import {
  ContractOutcomes,
  type ContractAdapter,
  type ContractArrangement,
  type ContractOperation,
  type ContractOutcome,
} from "./types";

const HEAD_SHA = "b".repeat(40);
const DIFF = "diff --git a/src/a.ts b/src/a.ts\n";

const REVIEW_LIST = [
  { id: 77, node_id: "PRR_77", state: "PENDING", body: "", user: { id: 501 } },
  {
    id: 78,
    node_id: "PRR_78",
    state: "COMMENTED",
    body: "Looks fine",
    user: { id: 501 },
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
const OK_ANSWERS: Readonly<Record<ContractOperation, StubResponse>> = {
  fetchPullRequest: answerOk(makePullRequestBody(7)),
  fetchPullRequestFiles: answerOk([
    { filename: "src/a.ts", additions: 3, deletions: 1 },
  ]),
  fetchDiff: answerOk(DIFF),
  fetchCompareDiff: answerOk(DIFF),
  fetchCompareFiles: answerOk({
    status: "ahead",
    files: [{ filename: "src/a.ts", status: "modified" }],
  }),
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
  fetchRenderedImageSources: answerGraphql({
    repository: {
      pullRequest: {
        bodyHTML: '<p><img alt="x" src="https://images.example/1.png"></p>',
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
    repository: { pullRequest: { id: "PR_7", isDraft: true } },
    markPullRequestReadyForReview: { pullRequest: { isDraft: false } },
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
  fetchComment: answerOk({ id: 1001, body: "Entry" }),
  postEntryComment: answerOk({ id: 1001 }),
  deleteComment: answerOk({}),
  // Every git-data step of the commit reads the field it needs from this one
  // body: the blob, tree and commit `sha`, the ref's `object`, the `tree`.
  commitAttachment: {
    status: 201,
    body: {
      sha: "c".repeat(40),
      object: { sha: "d".repeat(40) },
      tree: { sha: "e".repeat(40) },
    },
  },
  deleteAttachmentBranch: answerOk({}),
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

function selectAnswer(arrangement: ContractArrangement): StubResponse {
  if (arrangement.outcome === ContractOutcomes.OK) {
    return OK_ANSWERS[arrangement.operation];
  }
  return FAILURE_ANSWERS[arrangement.outcome];
}

/** The production bindings over a stubbed fetch that answers `arrangement`. */
export function createOctokitAdapter(
  arrangement: ContractArrangement,
): ContractAdapter {
  const stub = stubGitHubFetch(
    routeMinting(MINT_OK, selectAnswer(arrangement)),
  );
  const octokitFactory = makeOctokitFactory(stub);

  return {
    reviewer: bindReviewerGitHub(stubCredential("ghu_reviewer", undefined), {
      log: makeLogger(),
      octokitFactory,
    }),
    installation: bindInstallationGitHub(
      makeApp(stub),
      requireInstallationId(99n),
    ),
    operator: bindOperatorGitHub(requireOperatorToken("ghp_operator"), {
      octokitFactory,
    }),
    countRequests() {
      return stub.requests.filter((request) => request.path !== MINT_PATH)
        .length;
    },
  };
}
