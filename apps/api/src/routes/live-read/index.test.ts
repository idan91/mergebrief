// The live read over PGlite with GitHub served by the `github/testing` fake:
// what is due, how it is chunked, what is written back, the operator retry
// before an unreachable mark, and the ceiling.
import {
  LIVE_READ_PAGE_SIZE,
  isOperatorToken,
  type PullRequestInfo,
  type ReviewerCredential,
} from "github";
import {
  CredentialKinds,
  FakeFactsHidings,
  FakeFailures,
  makeFakeGitHub,
  type FakeGitHub,
} from "github/testing";
import type { Logger } from "logging";
import {
  createTenantRepository,
  isRepoId,
  isReviewerId,
  type PullRequestRow,
  type RepoId,
  type ReviewerId,
} from "persistence";
import { PrStates } from "types/pull-requests";
import { createPgliteHarness, type PgliteHarness } from "persistence/testing";
import type { Mutable } from "types/utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LIVE_READ_MAX_CHUNKS } from "./consts";
import {
  refreshUrlPullRequest,
  refreshUrlPullRequests,
  resetLiveReadMemory,
} from "./index";
import type { LiveFactsReader, LiveReadDeps } from "./types";

const VIEWER_TOKEN = "ghu_viewer";
const OTHER_TOKEN = "ghu_other_reader";
const OPERATOR_TOKEN = "ghp_operator";
const NOW = new Date("2026-09-20T12:00:00Z");
const HEAD = "a".repeat(40);

function brand<T extends bigint>(
  value: bigint,
  guard: (v: bigint) => v is T,
): T {
  if (!guard(value)) {
    throw new Error("unbrandable fixture value");
  }
  return value;
}
const OWNER: ReviewerId = brand(501n, isReviewerId);
const OTHER_READER: ReviewerId = brand(502n, isReviewerId);
const REPO: RepoId = brand(777n, isRepoId);
const OWNER_SCOPE = { ownerUserId: OWNER };

const log: Logger = {
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  child: () => log,
};

function stubCredential(token: string): ReviewerCredential {
  return {
    readToken: async () => ({ ok: true, value: token }),
    renewToken: async () => undefined,
  };
}

function makePullInfo(overrides?: Partial<PullRequestInfo>): PullRequestInfo {
  return {
    repoId: REPO,
    repoFullName: "o/r",
    headSha: HEAD,
    headRef: "feature",
    baseSha: "b".repeat(40),
    state: "open",
    draft: false,
    merged: false,
    title: "live title",
    body: "",
    htmlUrl: "https://github.com/o/r/pull/1",
    commitCount: 1,
    authorLogin: "octocat",
    closedAt: null,
    updatedAt: NOW,
    ...overrides,
  };
}

function buildPullRef(prNumber: number) {
  return { owner: "o", repo: "r", prNumber };
}

/** GitHub holds `o/r#1..count`, each with the given facts. */
function arrangePulls(
  count: number,
  overrides?: Partial<PullRequestInfo>,
): void {
  for (let prNumber = 1; prNumber <= count; prNumber += 1) {
    fake.addPullRequest(buildPullRef(prNumber), {
      info: makePullInfo(overrides),
    });
  }
}

/** Each live read that reached GitHub: the token it carried and its size. */
function listFactReads(): [string, number][] {
  return fake.listCalls("readPullRequestFacts").map((call) => {
    const token = "token" in call.credential ? call.credential.token : "";
    const size = Array.isArray(call.input) ? call.input.length : 0;
    return [token, size];
  });
}

/** The reader's reads, each held until `gate` opens. */
function holdReads(
  reader: LiveFactsReader,
  gate: Promise<void>,
): LiveFactsReader {
  return {
    async readPullRequestFacts(refs) {
      await gate;
      return reader.readPullRequestFacts(refs);
    },
  };
}

function openGate(): { gate: Promise<void>; release: () => void } {
  let release = (): void => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { gate, release };
}

let harness: PgliteHarness;
let fake: FakeGitHub;

beforeEach(async () => {
  harness = await createPgliteHarness();
  fake = makeFakeGitHub();
  vi.mocked(log.warn).mockReset();
  resetLiveReadMemory();
});

afterEach(async () => {
  await harness.close();
});

async function seedRows(
  count: number,
  repoSlug = "o/r",
): Promise<PullRequestRow[]> {
  const repo = createTenantRepository(harness.handle, OWNER_SCOPE);
  const rows: PullRequestRow[] = [];
  for (let prNumber = 1; prNumber <= count; prNumber += 1) {
    rows.push(
      await repo.pullRequests.upsert({
        repoId: REPO,
        prNumber,
        repoSlug,
        state: PrStates.OPEN,
      }),
    );
  }
  return rows;
}

async function readRow(prNumber: number): Promise<PullRequestRow> {
  const row = await createTenantRepository(
    harness.handle,
    OWNER_SCOPE,
  ).pullRequests.getByNumber(REPO, prNumber);
  if (row === undefined) {
    throw new Error(`row ${prNumber} missing`);
  }
  return row;
}

interface DepsOptions {
  readonly operator?: boolean;
  readonly waitMs?: number;
  readonly reader?: ReviewerId;
  readonly token?: string;
  readonly hold?: Promise<void>;
  readonly github?: LiveFactsReader;
}

function buildLiveDeps(options: DepsOptions = {}): LiveReadDeps {
  const bound = fake.bindReviewerGitHub(
    stubCredential(options.token ?? VIEWER_TOKEN),
    { log },
  );
  let github: LiveFactsReader = options.github ?? bound;
  if (options.hold !== undefined) {
    github = holdReads(github, options.hold);
  }
  const built: Mutable<LiveReadDeps> = {
    handle: harness.handle,
    github,
    readerId: options.reader ?? OWNER,
    log,
    now: () => NOW,
  };
  if (options.operator === true && isOperatorToken(OPERATOR_TOKEN)) {
    built.operator = fake.bindOperatorGitHub(OPERATOR_TOKEN);
  }
  if (options.waitMs !== undefined) {
    built.waitMs = options.waitMs;
  }
  return built;
}

describe("refreshUrlPullRequests", () => {
  it("asks GitHub nothing when no row is due", async () => {
    arrangePulls(2);
    await seedRows(2);
    await refreshUrlPullRequests(buildLiveDeps(), OWNER);

    const outcome = await refreshUrlPullRequests(buildLiveDeps(), OWNER);

    expect(outcome).toMatchObject({ read: 0, deferred: false });
    expect(listFactReads()).toHaveLength(1);
  });

  it("writes the facts and a live open beats a stored closed", async () => {
    arrangePulls(1, { title: "from GitHub", draft: true });
    await seedRows(1);
    await createTenantRepository(
      harness.handle,
      OWNER_SCOPE,
    ).pullRequests.upsert({
      repoId: REPO,
      prNumber: 1,
      state: PrStates.CLOSED,
      closedAt: new Date("2026-09-01T00:00:00Z"),
    });

    const outcome = await refreshUrlPullRequests(buildLiveDeps(), OWNER);

    expect(outcome).toMatchObject({ read: 1, unreachable: 0 });
    const updated = await readRow(1);
    expect(updated.state).toBe(PrStates.OPEN);
    expect(updated.closedAt).toBeNull();
    expect(updated.title).toBe("from GitHub");
    expect(updated.draft).toBe(true);
    expect(updated.githubHeadSha).toBe(HEAD);
    expect(updated.githubReadAt).toEqual(NOW);
    expect(updated.authorLogin).toBe("octocat");
  });

  it("reads in chunks of the page size and defers past the chunk cap", async () => {
    const cap = LIVE_READ_PAGE_SIZE * LIVE_READ_MAX_CHUNKS;
    arrangePulls(cap + 1);
    await seedRows(cap + 1);

    const outcome = await refreshUrlPullRequests(buildLiveDeps(), OWNER);

    expect(listFactReads().map(([, size]) => size)).toEqual(
      Array.from({ length: LIVE_READ_MAX_CHUNKS }, () => LIVE_READ_PAGE_SIZE),
    );
    expect(outcome).toMatchObject({ read: cap, deferred: true });
    expect((await readRow(cap + 1)).githubReadAt).toBeNull();
    expect((await readRow(cap)).githubReadAt).toEqual(NOW);
  });

  it("retries a missing row on the operator token before marking it", async () => {
    arrangePulls(2);
    fake.hideFacts(
      buildPullRef(2),
      CredentialKinds.REVIEWER,
      FakeFactsHidings.NOT_SHOWN,
    );
    await seedRows(3);

    const outcome = await refreshUrlPullRequests(
      buildLiveDeps({ operator: true }),
      OWNER,
    );

    expect(outcome).toMatchObject({ read: 2, unreachable: 1 });
    expect(listFactReads()).toEqual([
      [VIEWER_TOKEN, 3],
      [OPERATOR_TOKEN, 2],
    ]);
    expect((await readRow(2)).githubUnreachableAt).toBeNull();
    const gone = await readRow(3);
    expect(gone.githubUnreachableAt).toEqual(NOW);
    expect(gone.githubReadAt).toEqual(NOW);
    expect(gone.state).toBe(PrStates.OPEN);
  });

  it("marks a missing row without an operator reader", async () => {
    await seedRows(1);

    const outcome = await refreshUrlPullRequests(buildLiveDeps(), OWNER);

    expect(outcome).toMatchObject({ read: 0, unreachable: 1 });
    expect((await readRow(1)).githubUnreachableAt).toEqual(NOW);
  });

  it("facts about another repository are refused", async () => {
    arrangePulls(1, { repoId: brand(999n, isRepoId) });
    await seedRows(1);

    const outcome = await refreshUrlPullRequests(buildLiveDeps(), OWNER);

    expect(outcome).toMatchObject({ read: 0, unreachable: 1 });
    expect((await readRow(1)).title).toBeNull();
  });

  it("a row with no usable slug is marked unreachable, not re-read", async () => {
    await seedRows(1, "not-a-slug");

    const outcome = await refreshUrlPullRequests(buildLiveDeps(), OWNER);

    expect(outcome).toMatchObject({ read: 0, unreachable: 1 });
    expect(listFactReads()).toHaveLength(0);
    expect((await readRow(1)).githubUnreachableAt).toEqual(NOW);
  });

  it("a throw inside the read serves the stored rows as a failure", async () => {
    await seedRows(1);
    const github: LiveFactsReader = {
      readPullRequestFacts: async () => {
        throw new Error("boom");
      },
    };

    const outcome = await refreshUrlPullRequests(
      buildLiveDeps({ github }),
      OWNER,
    );

    expect(outcome).toMatchObject({ failed: true, timedOut: false });
    expect((await readRow(1)).githubReadAt).toBeNull();
  });

  it("a refused read cools the owner down for the window", async () => {
    fake.failOn("readPullRequestFacts", FakeFailures.RATE_LIMITED);
    const [row] = await seedRows(1);
    if (row === undefined) {
      throw new Error("seed failed");
    }
    await refreshUrlPullRequests(buildLiveDeps(), OWNER);

    const again = await refreshUrlPullRequests(buildLiveDeps(), OWNER);
    const one = await refreshUrlPullRequest(buildLiveDeps(), {
      scope: OWNER_SCOPE,
      row,
      repoFullName: "o/r",
    });

    expect(again).toMatchObject({ failed: true });
    expect(one.outcome).toMatchObject({ failed: true });
    expect(listFactReads()).toHaveLength(1);
  });

  it("another reader's refusal does not cool the owner down", async () => {
    arrangePulls(1);
    fake.rejectToken(OTHER_TOKEN);
    const [row] = await seedRows(1);
    if (row === undefined) {
      throw new Error("seed failed");
    }
    const other = buildLiveDeps({ reader: OTHER_READER, token: OTHER_TOKEN });
    const target = { scope: OWNER_SCOPE, row, repoFullName: "o/r" };
    await refreshUrlPullRequest(other, target);

    const owner = await refreshUrlPullRequests(buildLiveDeps(), OWNER);
    const again = await refreshUrlPullRequest(other, target);

    expect(owner).toMatchObject({ read: 1, failed: false });
    expect(again.outcome).toMatchObject({ failed: true });
    expect(listFactReads().map(([token]) => token)).toEqual([
      OTHER_TOKEN,
      VIEWER_TOKEN,
    ]);
  });

  it("a row GitHub gave no answer for waits the window", async () => {
    arrangePulls(2);
    fake.hideFacts(
      buildPullRef(1),
      CredentialKinds.REVIEWER,
      FakeFactsHidings.WITHHELD,
    );
    await seedRows(2);

    const outcome = await refreshUrlPullRequests(buildLiveDeps(), OWNER);

    expect(outcome).toMatchObject({ read: 1, unreachable: 0, failed: false });
    expect(listFactReads().map(([token]) => token)).toEqual([VIEWER_TOKEN]);
    const row = await readRow(1);
    expect(row.githubReadAt).toEqual(NOW);
    expect(row.githubUnreachableAt).toBeNull();
    expect(row.title).toBeNull();
    expect((await readRow(2)).githubReadAt).toEqual(NOW);
  });

  it("a row the viewer was refused is retried on the operator token", async () => {
    arrangePulls(2);
    fake.hideFacts(
      buildPullRef(1),
      CredentialKinds.REVIEWER,
      FakeFactsHidings.WITHHELD,
    );
    await seedRows(2);

    const outcome = await refreshUrlPullRequests(
      buildLiveDeps({ operator: true }),
      OWNER,
    );

    expect(outcome).toMatchObject({ read: 2, unreachable: 0, failed: false });
    expect(listFactReads()).toEqual([
      [VIEWER_TOKEN, 2],
      [OPERATOR_TOKEN, 1],
    ]);
    expect((await readRow(1)).title).toBe("live title");
  });

  it("a row refused to both tokens waits the window unmarked", async () => {
    arrangePulls(2);
    fake.hideFacts(
      buildPullRef(1),
      CredentialKinds.REVIEWER,
      FakeFactsHidings.WITHHELD,
    );
    fake.hideFacts(
      buildPullRef(1),
      CredentialKinds.OPERATOR,
      FakeFactsHidings.NOT_SHOWN,
    );
    await seedRows(2);

    const outcome = await refreshUrlPullRequests(
      buildLiveDeps({ operator: true }),
      OWNER,
    );

    expect(outcome).toMatchObject({ read: 1, unreachable: 0, failed: false });
    const row = await readRow(1);
    expect(row.githubReadAt).toEqual(NOW);
    expect(row.githubUnreachableAt).toBeNull();
  });

  it("a rejected operator token leaves the viewer's answer standing", async () => {
    fake.failOn(
      "readPullRequestFacts",
      FakeFailures.FORBIDDEN,
      CredentialKinds.OPERATOR,
    );
    await seedRows(1);

    const outcome = await refreshUrlPullRequests(
      buildLiveDeps({ operator: true }),
      OWNER,
    );

    expect(outcome).toMatchObject({ read: 0, unreachable: 1, failed: false });
    expect(listFactReads().map(([token]) => token)).toEqual([
      VIEWER_TOKEN,
      OPERATOR_TOKEN,
    ]);
    expect((await readRow(1)).githubUnreachableAt).toEqual(NOW);
    expect(log.warn).toHaveBeenCalledWith(
      "live read fallback token rejected by GitHub",
      { code: "forbidden" },
    );
  });

  it("a GitHub failure leaves the stored rows and warns", async () => {
    fake.failOn("readPullRequestFacts", FakeFailures.RATE_LIMITED);
    await seedRows(1);

    const outcome = await refreshUrlPullRequests(buildLiveDeps(), OWNER);

    expect(outcome).toMatchObject({ read: 0, failed: true });
    expect((await readRow(1)).githubReadAt).toBeNull();
    expect(log.warn).toHaveBeenCalledWith(
      "live read refused by GitHub, serving stored rows",
      { code: "rate-limited" },
    );
  });

  it("serves stored rows past the ceiling and finishes behind it", async () => {
    const { gate, release } = openGate();
    arrangePulls(1);
    await seedRows(1);

    const outcome = await refreshUrlPullRequests(
      buildLiveDeps({ waitMs: 5, hold: gate }),
      OWNER,
    );

    expect(outcome).toMatchObject({ timedOut: true, read: 0 });
    expect((await readRow(1)).githubReadAt).toBeNull();
    release();
    await vi.waitFor(async () => {
      expect((await readRow(1)).githubReadAt).toEqual(NOW);
    });
  });

  it("a caller arriving during a slow read joins it", async () => {
    const { gate, release } = openGate();
    arrangePulls(1);
    await seedRows(1);

    const first = refreshUrlPullRequests(
      buildLiveDeps({ waitMs: 5, hold: gate }),
      OWNER,
    );
    const second = refreshUrlPullRequests(
      buildLiveDeps({ waitMs: 5, hold: gate }),
      OWNER,
    );
    expect(await first).toMatchObject({ timedOut: true });
    expect(await second).toMatchObject({ timedOut: true });
    release();
    await vi.waitFor(async () => {
      expect((await readRow(1)).githubReadAt).toEqual(NOW);
    });

    expect(listFactReads()).toHaveLength(1);
  });

  it("another reader arriving during a slow read runs its own token", async () => {
    const { gate, release } = openGate();
    arrangePulls(1);
    await seedRows(1);

    const owner = refreshUrlPullRequests(
      buildLiveDeps({ waitMs: 5, hold: gate }),
      OWNER,
    );
    const other = refreshUrlPullRequests(
      buildLiveDeps({
        waitMs: 5,
        hold: gate,
        reader: OTHER_READER,
        token: OTHER_TOKEN,
      }),
      OWNER,
    );
    expect(await owner).toMatchObject({ timedOut: true });
    expect(await other).toMatchObject({ timedOut: true });
    release();
    await vi.waitFor(async () => {
      expect((await readRow(1)).githubReadAt).toEqual(NOW);
    });

    await vi.waitFor(() => {
      expect(listFactReads()).toHaveLength(2);
    });
  });
});

describe("refreshUrlPullRequest", () => {
  it("reads the one row by the verified name when it is due", async () => {
    arrangePulls(2);
    const [, row] = await seedRows(2, "stale/label");
    if (row === undefined) {
      throw new Error("seed failed");
    }

    const first = await refreshUrlPullRequest(buildLiveDeps(), {
      scope: OWNER_SCOPE,
      row,
      repoFullName: "o/r",
    });
    const again = await refreshUrlPullRequest(buildLiveDeps(), {
      scope: OWNER_SCOPE,
      row: first.row,
      repoFullName: "o/r",
    });

    expect(first.outcome).toMatchObject({ read: 1 });
    expect(again.outcome).toMatchObject({ read: 0 });
    const reads = fake.listCalls("readPullRequestFacts");
    expect(reads.map((call) => call.input)).toEqual([[buildPullRef(2)]]);
    expect((await readRow(1)).githubReadAt).toBeNull();
  });

  it("answers the row as the read's own write returned it", async () => {
    arrangePulls(1, { title: "from GitHub" });
    const [row] = await seedRows(1);
    if (row === undefined) {
      throw new Error("seed failed");
    }

    const read = await refreshUrlPullRequest(buildLiveDeps(), {
      scope: OWNER_SCOPE,
      row,
      repoFullName: "o/r",
    });

    expect(read.row).toEqual(await readRow(1));
    expect(read.row.title).toBe("from GitHub");
    expect(row.title).toBeNull();
  });

  it("answers the row it was given when the read writes nothing", async () => {
    fake.failOn("readPullRequestFacts", FakeFailures.SERVER_ERROR);
    const [row] = await seedRows(1);
    if (row === undefined) {
      throw new Error("seed failed");
    }

    const read = await refreshUrlPullRequest(buildLiveDeps(), {
      scope: OWNER_SCOPE,
      row,
      repoFullName: "o/r",
    });

    expect(read.outcome).toMatchObject({ failed: true });
    expect(read.row).toBe(row);
  });
});
