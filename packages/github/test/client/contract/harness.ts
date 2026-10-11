import { describe, expect, it } from "vitest";
import { REPO } from "../helpers";
import {
  ACCOUNT_READER_CASES,
  INSTALLATION_REPO_CASES,
  REPO_READER_CASES,
  REVIEWER_ACCOUNT_CASES,
  REVIEWER_REPO_CASES,
} from "./cases";
import {
  ContractOutcomes,
  type ContractAdapter,
  type ContractAdapterFactory,
  type ContractCase,
  type ContractOutcome,
} from "./types";

type DenialOutcome =
  | typeof ContractOutcomes.NOT_FOUND
  | typeof ContractOutcomes.FORBIDDEN
  | typeof ContractOutcomes.UNAUTHORIZED;

const DENIAL_CODES: Readonly<Record<DenialOutcome, string>> = {
  [ContractOutcomes.NOT_FOUND]: "not-found",
  [ContractOutcomes.FORBIDDEN]: "forbidden",
  [ContractOutcomes.UNAUTHORIZED]: "unauthorized",
};

const TOKEN_DENIALS: readonly DenialOutcome[] = [
  ContractOutcomes.NOT_FOUND,
  ContractOutcomes.FORBIDDEN,
  ContractOutcomes.UNAUTHORIZED,
];

/**
 * auth-app re-sends a request that 401s within five seconds of minting its
 * token, so an installation 401 is octokit's to retry, not a contract case.
 */
const INSTALLATION_DENIALS: readonly DenialOutcome[] = [
  ContractOutcomes.NOT_FOUND,
  ContractOutcomes.FORBIDDEN,
];

interface BindingUnderTest<Client> {
  readonly name: string;
  readonly select: (adapter: ContractAdapter) => Client;
  readonly denials: readonly DenialOutcome[];
}

interface CaseFamily<Client> {
  readonly name: string;
  readonly cases: readonly ContractCase<Client>[];
  readonly bindings: readonly BindingUnderTest<Client>[];
}

function makeReviewerBinding<Client>(
  select: (adapter: ContractAdapter) => Client,
): BindingUnderTest<Client> {
  return { name: "reviewer", select, denials: TOKEN_DENIALS };
}

function makeInstallationBinding<Client>(
  select: (adapter: ContractAdapter) => Client,
): BindingUnderTest<Client> {
  return { name: "installation", select, denials: INSTALLATION_DENIALS };
}

function makeOperatorBinding<Client>(
  select: (adapter: ContractAdapter) => Client,
): BindingUnderTest<Client> {
  return { name: "operator", select, denials: TOKEN_DENIALS };
}

function runCase<Client>(
  createAdapter: ContractAdapterFactory,
  testCase: ContractCase<Client>,
  binding: BindingUnderTest<Client>,
  outcome: ContractOutcome,
): Promise<unknown> {
  const adapter = createAdapter({ operation: testCase.operation, outcome });
  return testCase.call(binding.select(adapter));
}

/** A 404 the operation folds answers its value; any other denial its code. */
function shapeDenialAnswer<Client>(
  testCase: ContractCase<Client>,
  outcome: DenialOutcome,
): unknown {
  const folds =
    outcome === ContractOutcomes.NOT_FOUND && "notFound" in testCase;
  if (folds) {
    return { ok: true, value: testCase.notFound };
  }
  return {
    ok: false,
    error: expect.objectContaining({ code: DENIAL_CODES[outcome] }),
  };
}

function describeFamily<Client>(
  createAdapter: ContractAdapterFactory,
  family: CaseFamily<Client>,
): void {
  describe.each(family.bindings)(
    `${family.name} on the $name binding`,
    (binding) => {
      it.each(family.cases)(
        "$operation answers its value",
        async (testCase) => {
          const result = await runCase(
            createAdapter,
            testCase,
            binding,
            ContractOutcomes.OK,
          );

          expect(result).toEqual({ ok: true, value: testCase.expected });
        },
      );

      const denials = family.cases.flatMap((testCase) =>
        binding.denials.map((outcome) => ({
          operation: testCase.operation,
          testCase,
          outcome,
          expected: shapeDenialAnswer(testCase, outcome),
        })),
      );
      it.each(denials)(
        "$operation answers a $outcome denial",
        async ({ testCase, outcome, expected }) => {
          const result = await runCase(
            createAdapter,
            testCase,
            binding,
            outcome,
          );

          expect(result).toEqual(expected);
        },
      );
    },
  );
}

function describeCreates(createAdapter: ContractAdapterFactory): void {
  const creates = REVIEWER_REPO_CASES.filter((testCase) => testCase.create);

  it.each(creates)(
    "$operation reaches GitHub once on a 5xx",
    async (testCase) => {
      const adapter = createAdapter({
        operation: testCase.operation,
        outcome: ContractOutcomes.SERVER_ERROR,
      });

      const result = await testCase.call(adapter.reviewer.forRepo(REPO));

      expect(result).toMatchObject({ ok: false });
      expect(adapter.countRequests()).toBe(1);
    },
  );
}

function listOperations<Client>(
  cases: readonly ContractCase<Client>[],
): string[] {
  return cases.map((testCase) => testCase.operation);
}

function describeSurfaces(createAdapter: ContractAdapterFactory): void {
  const reviewerRepo = listOperations(REVIEWER_REPO_CASES);
  const installationRepo = listOperations(INSTALLATION_REPO_CASES);
  const reviewerOnly = reviewerRepo.filter(
    (operation) => !installationRepo.includes(operation),
  );
  const installationOnly = installationRepo.filter(
    (operation) => !reviewerRepo.includes(operation),
  );
  const adapter = createAdapter({
    operation: "fetchPullRequest",
    outcome: ContractOutcomes.OK,
  });

  it.each([...reviewerRepo, ...installationOnly])(
    "the operator binding has no %s",
    (operation) => {
      expect(adapter.operator.forRepo(REPO)).not.toHaveProperty(operation);
    },
  );

  it.each(reviewerOnly)("the installation binding has no %s", (operation) => {
    expect(adapter.installation.forRepo(REPO)).not.toHaveProperty(operation);
  });

  it.each(installationOnly)("the reviewer binding has no %s", (operation) => {
    expect(adapter.reviewer.forRepo(REPO)).not.toHaveProperty(operation);
  });

  it.each(listOperations(REVIEWER_ACCOUNT_CASES))(
    "only the reviewer binding has %s",
    (operation) => {
      expect(adapter.operator).not.toHaveProperty(operation);
      expect(adapter.installation).not.toHaveProperty(operation);
    },
  );
}

/** The behaviour every GitHub adapter owes, run against `createAdapter`. */
export function describeGitHubContract(
  adapterName: string,
  createAdapter: ContractAdapterFactory,
): void {
  describe(`GitHub contract: ${adapterName}`, () => {
    describeFamily(createAdapter, {
      name: "repo reads",
      cases: REPO_READER_CASES,
      bindings: [
        makeReviewerBinding((adapter) => adapter.reviewer.forRepo(REPO)),
        makeInstallationBinding((adapter) =>
          adapter.installation.forRepo(REPO),
        ),
        makeOperatorBinding((adapter) => adapter.operator.forRepo(REPO)),
      ],
    });
    describeFamily(createAdapter, {
      name: "account reads",
      cases: ACCOUNT_READER_CASES,
      bindings: [
        makeReviewerBinding((adapter) => adapter.reviewer),
        makeInstallationBinding((adapter) => adapter.installation),
        makeOperatorBinding((adapter) => adapter.operator),
      ],
    });
    describeFamily(createAdapter, {
      name: "reviewer account",
      cases: REVIEWER_ACCOUNT_CASES,
      bindings: [makeReviewerBinding((adapter) => adapter.reviewer)],
    });
    describeFamily(createAdapter, {
      name: "reviewer repo",
      cases: REVIEWER_REPO_CASES,
      bindings: [
        makeReviewerBinding((adapter) => adapter.reviewer.forRepo(REPO)),
      ],
    });
    describeFamily(createAdapter, {
      name: "installation repo",
      cases: INSTALLATION_REPO_CASES,
      bindings: [
        makeInstallationBinding((adapter) =>
          adapter.installation.forRepo(REPO),
        ),
      ],
    });
    describe("creates", () => {
      describeCreates(createAdapter);
    });
    describe("credential surfaces", () => {
      describeSurfaces(createAdapter);
    });
  });
}
