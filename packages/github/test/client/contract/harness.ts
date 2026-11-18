import { describe, expect, it } from "vitest";
import { REPO } from "../helpers";
import {
  ACCOUNT_READER_CASES,
  APP_CASES,
  INSTALLATION_ACCOUNT_CASES,
  INSTALLATION_REPO_CASES,
  REPO_READER_CASES,
  REVIEWER_ACCOUNT_CASES,
  REVIEWER_REPO_CASES,
} from "./cases";
import type { DenialOutcome } from "./consts";
import { describeReviewerCredential } from "./credentials";
import {
  ContractOutcomes,
  type ContractAdapter,
  type ContractAdapterFactory,
  type ContractCase,
  type ContractOutcome,
} from "./types";
import { selectCases, shapeDenialAnswer } from "./utils";

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

/** An App-JWT read: no token to renew, so a 401 is no contract case either. */
const APP_DENIALS: readonly DenialOutcome[] = [
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

function describeRefusedMint<Client>(
  createAdapter: ContractAdapterFactory,
  cases: readonly ContractCase<Client>[],
  select: (adapter: ContractAdapter) => Client,
): void {
  it.each(cases)(
    "$operation answers a refused mint as not-found",
    async (testCase) => {
      const adapter = createAdapter({
        operation: testCase.operation,
        outcome: ContractOutcomes.OK,
        mintRefused: true,
      });

      const result = await testCase.call(select(adapter));

      expect(result).toEqual(
        shapeDenialAnswer(testCase, ContractOutcomes.NOT_FOUND),
      );
    },
  );
}

function listOperations<Client>(
  cases: readonly ContractCase<Client>[],
): string[] {
  return cases.map((testCase) => testCase.operation);
}

function listSurface(...operationLists: readonly string[][]): string[] {
  const operations = new Set(operationLists.flat());
  return [...operations].toSorted();
}

function listKeys(client: object): string[] {
  return Object.keys(client).toSorted();
}

function describeSurfaces(createAdapter: ContractAdapterFactory): void {
  const repoReads = listOperations(REPO_READER_CASES);
  const accountReads = listOperations(ACCOUNT_READER_CASES);
  const adapter = createAdapter({
    operation: "fetchPullRequest",
    outcome: ContractOutcomes.OK,
  });
  const surfaces = [
    {
      binding: "operator",
      client: adapter.operator,
      account: listSurface(accountReads, ["forRepo"]),
      repo: listSurface(repoReads),
    },
    {
      binding: "installation",
      client: adapter.installation,
      account: listSurface(
        accountReads,
        listOperations(INSTALLATION_ACCOUNT_CASES),
        ["forRepo"],
      ),
      repo: listSurface(repoReads, listOperations(INSTALLATION_REPO_CASES)),
    },
    {
      binding: "reviewer",
      client: adapter.reviewer,
      account: listSurface(
        accountReads,
        listOperations(REVIEWER_ACCOUNT_CASES),
        ["forRepo"],
      ),
      repo: listSurface(repoReads, listOperations(REVIEWER_REPO_CASES)),
    },
  ];

  it.each(surfaces)(
    "the $binding binding exposes exactly its operations",
    ({ client, account, repo }) => {
      const exposed = {
        account: listKeys(client),
        repo: listKeys(client.forRepo(REPO)),
      };

      expect(exposed).toEqual({ account, repo });
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
      ],
    });
    describeFamily(createAdapter, {
      name: "repo reads",
      cases: selectCases(REPO_READER_CASES, ["fetchPullRequest"]),
      bindings: [
        makeInstallationBinding((adapter) =>
          adapter.installation.forRepo(REPO),
        ),
        makeOperatorBinding((adapter) => adapter.operator.forRepo(REPO)),
      ],
    });
    describeFamily(createAdapter, {
      name: "account reads",
      cases: ACCOUNT_READER_CASES,
      bindings: [makeReviewerBinding((adapter) => adapter.reviewer)],
    });
    describeFamily(createAdapter, {
      name: "account reads",
      cases: selectCases(ACCOUNT_READER_CASES, ["fetchRepositoryById"]),
      bindings: [
        makeInstallationBinding((adapter) => adapter.installation),
        makeOperatorBinding((adapter) => adapter.operator),
      ],
    });
    describeFamily(createAdapter, {
      name: "installation account",
      cases: INSTALLATION_ACCOUNT_CASES,
      bindings: [makeInstallationBinding((adapter) => adapter.installation)],
    });
    describeFamily(createAdapter, {
      name: "app reads",
      cases: APP_CASES,
      bindings: [
        { name: "app", select: (adapter) => adapter.app, denials: APP_DENIALS },
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
    describe("installation binding with a refused mint", () => {
      describeRefusedMint(
        createAdapter,
        INSTALLATION_ACCOUNT_CASES,
        (adapter) => adapter.installation,
      );
      describeRefusedMint(
        createAdapter,
        selectCases(ACCOUNT_READER_CASES, ["fetchRepositoryById"]),
        (adapter) => adapter.installation,
      );
      describeRefusedMint(
        createAdapter,
        [
          ...selectCases(REPO_READER_CASES, ["fetchPullRequest"]),
          ...INSTALLATION_REPO_CASES,
        ],
        (adapter) => adapter.installation.forRepo(REPO),
      );
    });
    describe("credential surfaces", () => {
      describeSurfaces(createAdapter);
    });
    describeReviewerCredential(createAdapter);
  });
}
