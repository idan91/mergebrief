import { describe, expect, it } from "vitest";
import {
  CredentialFailureCodes,
  type CredentialFailure,
  type GitHubCall,
  type ReviewerCredential,
  type ReviewerGitHub,
  type ReviewerRepoClient,
} from "../../../src/client/types";
import type { GitHubOperation } from "../../../src/testing/types";
import { REPO, stubCredential } from "../helpers";
import {
  ACCOUNT_READER_CASES,
  REPO_READER_CASES,
  REVIEWER_ACCOUNT_CASES,
  REVIEWER_REPO_CASES,
} from "./cases";
import {
  OPERATOR_READS,
  RENEWED_TOKEN,
  REPO_FILE_MAX_BYTES,
  REVIEWER_TOKEN,
  UNKNOWN_SHA,
  type DenialOutcome,
} from "./consts";
import {
  ContractOutcomes,
  type ContractAdapterFactory,
  type ContractCase,
} from "./types";
import { selectCases, shapeDenialAnswer } from "./utils";

const REPO_CASES: readonly ContractCase<ReviewerRepoClient>[] = [
  ...REPO_READER_CASES,
  ...REVIEWER_REPO_CASES,
];

const REACH_CASES = REPO_CASES.filter((testCase) => testCase.operatorReach);

const FORBIDDEN_FALLBACKS: readonly GitHubOperation[] = [
  "fetchPullRequest",
  "fetchRepoFile",
  "createInlineReviewComment",
];

const SAMPLE_REPO_READS: readonly GitHubOperation[] = [
  "fetchPullRequest",
  "fetchRepoFile",
];

const SAMPLE_REVIEWER_CALLS: readonly GitHubOperation[] = [
  "fetchPullRequest",
  "fetchRepositoryById",
  "listUserInstallations",
];

const UNREADABLE: CredentialFailure = {
  code: CredentialFailureCodes.CREDENTIAL_UNREADABLE,
  message: "reviewer token unreadable",
};

function stubUnreadableCredential(): ReviewerCredential {
  return {
    readToken: async () => ({ ok: false, error: UNREADABLE }),
    renewToken: async () => undefined,
  };
}

function shapeFallbackAnswer(
  testCase: ContractCase<ReviewerRepoClient>,
  denial: DenialOutcome,
): unknown {
  if (testCase.operatorReach === true) {
    return { ok: true, value: testCase.expected };
  }
  return shapeDenialAnswer(testCase, denial);
}

interface FallbackRow {
  readonly operation: GitHubOperation;
  readonly testCase: ContractCase<ReviewerRepoClient>;
  readonly denial: DenialOutcome;
  readonly expected: unknown;
}

function buildFallbackRow(
  testCase: ContractCase<ReviewerRepoClient>,
  denial: DenialOutcome,
): FallbackRow {
  return {
    operation: testCase.operation,
    testCase,
    denial,
    expected: shapeFallbackAnswer(testCase, denial),
  };
}

function bindOperatorBacked(
  createAdapter: ContractAdapterFactory,
  operation: GitHubOperation,
  reviewerOutcome: DenialOutcome,
  outcome: typeof ContractOutcomes.OK | typeof ContractOutcomes.UNAUTHORIZED,
): ReviewerGitHub {
  const adapter = createAdapter({ operation, outcome, reviewerOutcome });
  const credential = stubCredential(REVIEWER_TOKEN, undefined);
  return adapter.bindReviewer(credential, OPERATOR_READS);
}

function describeOperatorReads(createAdapter: ContractAdapterFactory): void {
  const notFoundFallbacks = REPO_CASES.map((testCase) =>
    buildFallbackRow(testCase, ContractOutcomes.NOT_FOUND),
  );
  const forbiddenFallbacks = selectCases(REPO_CASES, FORBIDDEN_FALLBACKS).map(
    (testCase) => buildFallbackRow(testCase, ContractOutcomes.FORBIDDEN),
  );
  const fallbacks = [...notFoundFallbacks, ...forbiddenFallbacks];

  it.each(fallbacks)(
    "$operation after a reviewer $denial",
    async ({ operation, testCase, denial, expected }) => {
      const github = bindOperatorBacked(
        createAdapter,
        operation,
        denial,
        ContractOutcomes.OK,
      );

      const result = await testCase.call(github.forRepo(REPO));

      expect(result).toEqual(expected);
    },
  );

  it.each(selectCases(REACH_CASES, ["fetchPullRequest"]))(
    "$operation keeps the reviewer's denial on an operator 401",
    async (testCase) => {
      const github = bindOperatorBacked(
        createAdapter,
        testCase.operation,
        ContractOutcomes.NOT_FOUND,
        ContractOutcomes.UNAUTHORIZED,
      );

      const result = await testCase.call(github.forRepo(REPO));

      expect(result).toEqual(
        shapeDenialAnswer(testCase, ContractOutcomes.NOT_FOUND),
      );
    },
  );

  it.each(selectCases(REACH_CASES, SAMPLE_REPO_READS))(
    "$operation answers a 404 both tokens get",
    async (testCase) => {
      const adapter = createAdapter({
        operation: testCase.operation,
        outcome: ContractOutcomes.NOT_FOUND,
        reviewerOutcome: ContractOutcomes.NOT_FOUND,
      });
      const credential = stubCredential(REVIEWER_TOKEN, undefined);
      const github = adapter.bindReviewer(credential, OPERATOR_READS);

      const result = await testCase.call(github.forRepo(REPO));

      expect(result).toEqual(
        shapeDenialAnswer(testCase, ContractOutcomes.NOT_FOUND),
      );
      expect(adapter.countRequests()).toBe(2);
    },
  );

  const otherPullRequestReads = [
    {
      operation: "fetchPullRequest",
      call: (client: ReviewerRepoClient) => client.fetchPullRequest(8),
    },
    {
      operation: "fetchDiff",
      call: (client: ReviewerRepoClient) => client.fetchDiff(8),
    },
  ] as const;

  it.each(otherPullRequestReads)(
    "$operation on another PR keeps the denial off the operator token",
    async ({ operation, call }) => {
      const adapter = createAdapter({
        operation,
        outcome: ContractOutcomes.OK,
        reviewerOutcome: ContractOutcomes.NOT_FOUND,
      });
      const credential = stubCredential(REVIEWER_TOKEN, undefined);
      const github = adapter.bindReviewer(credential, OPERATOR_READS);

      const result = await call(github.forRepo(REPO));

      expect(result).toEqual({
        ok: false,
        error: expect.objectContaining({ code: "not-found" }),
      });
      expect(adapter.countRequests()).toBe(1);
    },
  );

  it.each(selectCases(REACH_CASES, SAMPLE_REPO_READS))(
    "$operation keeps a 404 in another repository",
    async (testCase) => {
      const adapter = createAdapter({
        operation: testCase.operation,
        outcome: ContractOutcomes.OK,
        reviewerOutcome: ContractOutcomes.NOT_FOUND,
      });
      const credential = stubCredential(REVIEWER_TOKEN, undefined);
      const github = adapter.bindReviewer(credential, OPERATOR_READS);

      const result = await testCase.call(
        github.forRepo({ owner: "acme", repo: "secrets" }),
      );

      expect(result).toEqual(
        shapeDenialAnswer(testCase, ContractOutcomes.NOT_FOUND),
      );
      expect(adapter.countRequests()).toBe(1);
    },
  );

  const fileReadsOutsideKnownCommits = [
    {
      name: "fetchRepoFile at an unknown commit",
      call: (client: ReviewerRepoClient) =>
        client.fetchRepoFile({
          path: ".mergebrief.yml",
          ref: UNKNOWN_SHA,
          maxBytes: REPO_FILE_MAX_BYTES,
        }),
    },
    {
      name: "fetchRepoFile on the default branch",
      call: (client: ReviewerRepoClient) =>
        client.fetchRepoFile({
          path: ".mergebrief.yml",
          maxBytes: REPO_FILE_MAX_BYTES,
        }),
    },
  ] as const;

  it.each(fileReadsOutsideKnownCommits)(
    "$name folds a 404 off the operator token",
    async ({ call }) => {
      const adapter = createAdapter({
        operation: "fetchRepoFile",
        outcome: ContractOutcomes.OK,
        reviewerOutcome: ContractOutcomes.NOT_FOUND,
      });
      const credential = stubCredential(REVIEWER_TOKEN, undefined);
      const github = adapter.bindReviewer(credential, OPERATOR_READS);

      const result = await call(github.forRepo(REPO));

      expect(result).toEqual({ ok: true, value: { kind: "absent" } });
      expect(adapter.countRequests()).toBe(1);
    },
  );
}

async function countBaselineRequests(
  createAdapter: ContractAdapterFactory,
  { operation, call }: ReviewerCall,
): Promise<number> {
  const adapter = createAdapter({ operation, outcome: ContractOutcomes.OK });
  await call(adapter.reviewer);
  return adapter.countRequests();
}

function describeRenewal(createAdapter: ContractAdapterFactory): void {
  it.each(listReviewerCalls())(
    "$operation reruns on the renewed token after a 401",
    async (reviewerCall) => {
      const baseline = await countBaselineRequests(createAdapter, reviewerCall);
      const adapter = createAdapter({
        operation: reviewerCall.operation,
        outcome: ContractOutcomes.OK,
        reviewerOutcome: ContractOutcomes.UNAUTHORIZED,
      });
      const credential = stubCredential(REVIEWER_TOKEN, RENEWED_TOKEN);

      const result = await reviewerCall.call(adapter.bindReviewer(credential));

      expect(result).toMatchObject({ ok: true });
      expect(adapter.countRequests()).toBe(baseline + 1);
    },
  );

  it.each(selectReviewerCalls(SAMPLE_REVIEWER_CALLS))(
    "$operation answers a 401 on the renewed token without renewing again",
    async ({ operation, call }) => {
      const adapter = createAdapter({
        operation,
        outcome: ContractOutcomes.UNAUTHORIZED,
        reviewerOutcome: ContractOutcomes.UNAUTHORIZED,
      });
      const credential = stubCredential(REVIEWER_TOKEN, RENEWED_TOKEN);

      const result = await call(adapter.bindReviewer(credential));

      expect(result).toEqual({
        ok: false,
        error: expect.objectContaining({ code: "unauthorized" }),
      });
      expect(adapter.countRequests()).toBe(2);
    },
  );
}

interface ReviewerCall {
  readonly operation: GitHubOperation;
  readonly call: (github: ReviewerGitHub) => GitHubCall<unknown>;
}

function listReviewerCalls(): ReviewerCall[] {
  const onRepo = REPO_CASES.map((testCase) => ({
    operation: testCase.operation,
    call: (github: ReviewerGitHub) => testCase.call(github.forRepo(REPO)),
  }));
  return [...onRepo, ...ACCOUNT_READER_CASES, ...REVIEWER_ACCOUNT_CASES];
}

function selectReviewerCalls(
  operations: readonly GitHubOperation[],
): ReviewerCall[] {
  return listReviewerCalls().filter((reviewerCall) =>
    operations.includes(reviewerCall.operation),
  );
}

function describeUnreadableCredential(
  createAdapter: ContractAdapterFactory,
): void {
  it.each(selectReviewerCalls(["fetchPullRequest"]))(
    "$operation answers an unreadable credential unsent",
    async ({ operation, call }) => {
      const adapter = createAdapter({
        operation,
        outcome: ContractOutcomes.OK,
      });

      const result = await call(
        adapter.bindReviewer(stubUnreadableCredential()),
      );

      expect(result).toEqual({ ok: false, error: UNREADABLE });
      expect(adapter.countRequests()).toBe(0);
    },
  );
}

/** The reviewer credential's rules: the operator fallback and a missing token. */
export function describeReviewerCredential(
  createAdapter: ContractAdapterFactory,
): void {
  describe("operator reads", () => {
    describeOperatorReads(createAdapter);
  });
  describe("unreadable credential", () => {
    describeUnreadableCredential(createAdapter);
  });
  describe("token renewal", () => {
    describeRenewal(createAdapter);
  });
}
