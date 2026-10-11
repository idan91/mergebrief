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
  DENIAL_CODES,
  OPERATOR_READS,
  RENEWED_TOKEN,
  REVIEWER_TOKEN,
  type DenialOutcome,
} from "./consts";
import {
  ContractOutcomes,
  type ContractAdapterFactory,
  type ContractCase,
} from "./types";

const REPO_CASES: readonly ContractCase<ReviewerRepoClient>[] = [
  ...REPO_READER_CASES,
  ...REVIEWER_REPO_CASES,
];

const REACH_CASES = REPO_CASES.filter((testCase) => testCase.operatorReach);

const READ_DENIALS: readonly DenialOutcome[] = [
  ContractOutcomes.NOT_FOUND,
  ContractOutcomes.FORBIDDEN,
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

/** A fold wins first, then the operator's answer inside its reach. */
function shapeFallbackAnswer(
  testCase: ContractCase<ReviewerRepoClient>,
  denial: DenialOutcome,
): unknown {
  const folds = denial === ContractOutcomes.NOT_FOUND && "notFound" in testCase;
  if (folds) {
    return { ok: true, value: testCase.notFound };
  }
  if (testCase.operatorReach === true) {
    return { ok: true, value: testCase.expected };
  }
  return {
    ok: false,
    error: expect.objectContaining({ code: DENIAL_CODES[denial] }),
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
  const fallbacks = REPO_CASES.flatMap((testCase) =>
    READ_DENIALS.map((denial) => ({
      operation: testCase.operation,
      testCase,
      denial,
      expected: shapeFallbackAnswer(testCase, denial),
    })),
  );

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

  it.each(REACH_CASES)(
    "$operation keeps the reviewer's denial on an operator 401",
    async (testCase) => {
      const github = bindOperatorBacked(
        createAdapter,
        testCase.operation,
        ContractOutcomes.NOT_FOUND,
        ContractOutcomes.UNAUTHORIZED,
      );

      const result = await testCase.call(github.forRepo(REPO));

      expect(result).toEqual({
        ok: false,
        error: expect.objectContaining({ code: "not-found" }),
      });
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

  it.each(REACH_CASES)(
    "$operation stays denied in another repository",
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

      expect(result).toMatchObject({ ok: false });
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

  it.each(listReviewerCalls())(
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

function describeUnreadableCredential(
  createAdapter: ContractAdapterFactory,
): void {
  it.each(listReviewerCalls())(
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
