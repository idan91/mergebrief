// The live read over PGlite with the GitHub read mocked at the package
// seam: what is due, how it is chunked, what is written back, the operator
// retry before an unreachable mark, and the ceiling.
import type * as githubModule from "github";
import {
  getLiveReadKey,
  readPullRequestFacts,
  type LiveReadPage,
  type PullRequestFacts,
  type PullRequestRef,
} from "github";
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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ReviewerGitHubClient,
  UserOctokit,
} from "../auth/reviewer-github-client";
import type { ViewerPrincipal } from "../auth/session/types";
import { LIVE_READ_CHUNK_SIZE, LIVE_READ_MAX_CHUNKS } from "./consts";
import type { Mutable } from "types/utils";
import {
  refreshUrlPullRequest,
  refreshUrlPullRequests,
  resetLiveReadMemory,
} from "./index";
import type { LiveReadDeps } from "./types";

vi.mock("github", async (importOriginal) => ({
  ...(await importOriginal<typeof githubModule>()),
  readPullRequestFacts: vi.fn(),
}));

const VIEWER_TOKEN = "ghu_viewer";
const OPERATOR_TOKEN = "ghp_operator";
const NOW = new Date("2026-09-20T12:00:00Z");
const HEAD = "a".repeat(40);

function brand<T extends bigint>(
  value: bigint,
  guard: (v: bigint) => v is T,
): T {
  if (!guard(value)) throw new Error("unbrandable fixture value");
  return value;
}
const OWNER: ReviewerId = brand(501n, isReviewerId);
const OTHER_READER: ReviewerId = brand(502n, isReviewerId);
const REPO: RepoId = brand(777n, isRepoId);

const log: Logger = {
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  child: () => log,
};

/** A client for one reader; the live read reads only the reviewer id. */
function stubClient(reviewerId: ReviewerId): ReviewerGitHubClient {
  return {
    run: async (call) => call(VIEWER_TOKEN),
    runRead: async (call) => call(VIEWER_TOKEN),
    createOctokit: (token) => ({ token }) as unknown as UserOctokit,
    createMutationOctokit: () => {
      throw new Error("the live read writes nothing to GitHub");
    },
    session: () => ({ reviewerId }) as unknown as ViewerPrincipal,
  };
}

/** The token a stubbed octokit was built with, read back inside the read mock. */
interface TokenOctokit {
  readonly token: string;
}

function stubFacts(overrides?: Partial<PullRequestFacts>): PullRequestFacts {
  return {
    repoId: REPO,
    repoFullName: "o/r",
    state: "open",
    merged: false,
    draft: false,
    title: "live title",
    closedAt: null,
    updatedAt: NOW,
    headSha: HEAD,
    authorLogin: "octocat",
    ...overrides,
  };
}

interface ReadCall {
  readonly token: string;
  readonly refs: readonly PullRequestRef[];
}

/** Answer every read from `answer`; record which token asked for what. */
function stubReads(
  answer: (token: string, ref: PullRequestRef) => PullRequestFacts | null,
): ReadCall[] {
  const calls: ReadCall[] = [];
  vi.mocked(readPullRequestFacts).mockImplementation(async (octokit, refs) => {
    const { token } = octokit as unknown as TokenOctokit;
    calls.push({ token, refs });
    const page = new Map<string, PullRequestFacts | null>();
    for (const ref of refs) page.set(getLiveReadKey(ref), answer(token, ref));
    return { ok: true, value: page satisfies LiveReadPage };
  });
  return calls;
}

/** Like stubReads, but an undefined answer leaves the alias out of the page. */
function stubWithheldReads(
  answer: (
    token: string,
    ref: PullRequestRef,
  ) => PullRequestFacts | null | undefined,
): ReadCall[] {
  const calls: ReadCall[] = [];
  vi.mocked(readPullRequestFacts).mockImplementation(async (octokit, refs) => {
    const { token } = octokit as unknown as TokenOctokit;
    calls.push({ token, refs });
    const page = new Map<string, PullRequestFacts | null>();
    for (const ref of refs) {
      const facts = answer(token, ref);
      if (facts !== undefined) page.set(getLiveReadKey(ref), facts);
    }
    return { ok: true, value: page satisfies LiveReadPage };
  });
  return calls;
}

let harness: PgliteHarness;

beforeEach(async () => {
  harness = await createPgliteHarness();
  vi.mocked(readPullRequestFacts).mockReset();
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
  const repo = createTenantRepository(harness.handle, { ownerUserId: OWNER });
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
  const row = await createTenantRepository(harness.handle, {
    ownerUserId: OWNER,
  }).pullRequests.getByNumber(REPO, prNumber);
  if (row === undefined) throw new Error(`row ${prNumber} missing`);
  return row;
}

function deps(overrides?: {
  fallbackToken?: string;
  waitMs?: number;
  reader?: ReviewerId;
}): LiveReadDeps {
  const built: Mutable<LiveReadDeps> = {
    handle: harness.handle,
    github: stubClient(overrides?.reader ?? OWNER),
    log,
    now: () => NOW,
  };
  if (overrides?.fallbackToken !== undefined) {
    built.fallbackToken = overrides.fallbackToken;
  }
  if (overrides?.waitMs !== undefined) built.waitMs = overrides.waitMs;
  return built;
}

describe("refreshUrlPullRequests", () => {
  it("asks GitHub nothing when no row is due", async () => {
    const calls = stubReads(() => stubFacts());
    await seedRows(2);
    await refreshUrlPullRequests(deps(), OWNER);
    calls.length = 0;

    const outcome = await refreshUrlPullRequests(deps(), OWNER);

    expect(outcome).toMatchObject({ read: 0, deferred: false });
    expect(calls).toHaveLength(0);
  });

  it("writes the facts and a live open beats a stored closed", async () => {
    stubReads(() => stubFacts({ title: "from GitHub", draft: true }));
    const [row] = await seedRows(1);
    if (row === undefined) throw new Error("seed failed");
    await createTenantRepository(harness.handle, {
      ownerUserId: OWNER,
    }).pullRequests.upsert({
      repoId: REPO,
      prNumber: 1,
      state: PrStates.CLOSED,
      closedAt: new Date("2026-09-01T00:00:00Z"),
      purgeAfter: null,
    });

    const outcome = await refreshUrlPullRequests(deps(), OWNER);

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
    const calls = stubReads(() => stubFacts());
    const cap = LIVE_READ_CHUNK_SIZE * LIVE_READ_MAX_CHUNKS;
    await seedRows(cap + 1);

    const outcome = await refreshUrlPullRequests(deps(), OWNER);

    expect(calls.map((call) => call.refs.length)).toEqual(
      Array.from({ length: LIVE_READ_MAX_CHUNKS }, () => LIVE_READ_CHUNK_SIZE),
    );
    expect(outcome).toMatchObject({ read: cap, deferred: true });
    expect((await readRow(cap + 1)).githubReadAt).toBeNull();
    expect((await readRow(cap)).githubReadAt).toEqual(NOW);
  });

  it("retries a missing row on the operator token before marking it", async () => {
    const calls = stubReads((token, ref) => {
      if (ref.prNumber === 1) return stubFacts();
      if (ref.prNumber === 2 && token === OPERATOR_TOKEN) return stubFacts();
      return null;
    });
    await seedRows(3);

    const outcome = await refreshUrlPullRequests(
      deps({ fallbackToken: OPERATOR_TOKEN }),
      OWNER,
    );

    expect(outcome).toMatchObject({ read: 2, unreachable: 1 });
    expect(calls.map((call) => [call.token, call.refs.length])).toEqual([
      [VIEWER_TOKEN, 3],
      [OPERATOR_TOKEN, 2],
    ]);
    expect((await readRow(2)).githubUnreachableAt).toBeNull();
    const gone = await readRow(3);
    expect(gone.githubUnreachableAt).toEqual(NOW);
    expect(gone.githubReadAt).toEqual(NOW);
    expect(gone.state).toBe(PrStates.OPEN);
  });

  it("marks a missing row without an operator token", async () => {
    stubReads(() => null);
    await seedRows(1);

    const outcome = await refreshUrlPullRequests(deps(), OWNER);

    expect(outcome).toMatchObject({ read: 0, unreachable: 1 });
    expect((await readRow(1)).githubUnreachableAt).toEqual(NOW);
  });

  it("facts about another repository are refused", async () => {
    stubReads(() => stubFacts({ repoId: brand(999n, isRepoId) }));
    await seedRows(1);

    const outcome = await refreshUrlPullRequests(deps(), OWNER);

    expect(outcome).toMatchObject({ read: 0, unreachable: 1 });
    expect((await readRow(1)).title).toBeNull();
  });

  it("a row with no usable slug is marked unreachable, not re-read", async () => {
    const calls = stubReads(() => stubFacts());
    await seedRows(1, "not-a-slug");

    const outcome = await refreshUrlPullRequests(deps(), OWNER);

    expect(outcome).toMatchObject({ read: 0, unreachable: 1 });
    expect(calls).toHaveLength(0);
    expect((await readRow(1)).githubUnreachableAt).toEqual(NOW);
  });

  it("a throw inside the read serves the stored rows as a failure", async () => {
    vi.mocked(readPullRequestFacts).mockRejectedValue(new Error("boom"));
    await seedRows(1);

    const outcome = await refreshUrlPullRequests(deps(), OWNER);

    expect(outcome).toMatchObject({ failed: true, timedOut: false });
    expect((await readRow(1)).githubReadAt).toBeNull();
  });

  it("a refused read cools the owner down for the window", async () => {
    vi.mocked(readPullRequestFacts).mockResolvedValue({
      ok: false,
      error: { code: "rate-limited", status: 403, message: "read failed" },
    });
    await seedRows(1);
    await refreshUrlPullRequests(deps(), OWNER);
    const calls = stubReads(() => stubFacts());

    const again = await refreshUrlPullRequests(deps(), OWNER);
    const one = await refreshUrlPullRequest(deps(), OWNER, REPO, 1, "o/r");

    expect(again).toMatchObject({ failed: true });
    expect(one).toMatchObject({ failed: true });
    expect(calls).toHaveLength(0);
  });

  it("another reader's refusal does not cool the owner down", async () => {
    vi.mocked(readPullRequestFacts).mockResolvedValue({
      ok: false,
      error: { code: "rate-limited", status: 403, message: "read failed" },
    });
    await seedRows(1);
    const other = deps({ reader: OTHER_READER });
    await refreshUrlPullRequest(other, OWNER, REPO, 1, "o/r");
    const calls = stubReads(() => stubFacts());

    const owner = await refreshUrlPullRequests(deps(), OWNER);
    const again = await refreshUrlPullRequest(other, OWNER, REPO, 1, "o/r");

    expect(owner).toMatchObject({ read: 1, failed: false });
    expect(again).toMatchObject({ failed: true });
    expect(calls).toHaveLength(1);
  });

  it("a row GitHub gave no answer for waits the window", async () => {
    const calls = stubWithheldReads((token, ref) => {
      if (ref.prNumber === 1) return undefined;
      return stubFacts();
    });
    await seedRows(2);

    const outcome = await refreshUrlPullRequests(deps(), OWNER);

    expect(outcome).toMatchObject({ read: 1, unreachable: 0, failed: false });
    expect(calls.map((call) => call.token)).toEqual([VIEWER_TOKEN]);
    const row = await readRow(1);
    expect(row.githubReadAt).toEqual(NOW);
    expect(row.githubUnreachableAt).toBeNull();
    expect(row.title).toBeNull();
    expect((await readRow(2)).githubReadAt).toEqual(NOW);
  });

  it("a row the viewer was refused is retried on the operator token", async () => {
    const calls = stubWithheldReads((token, ref) => {
      if (ref.prNumber !== 1) return stubFacts();
      return token === OPERATOR_TOKEN ? stubFacts() : undefined;
    });
    await seedRows(2);

    const outcome = await refreshUrlPullRequests(
      deps({ fallbackToken: OPERATOR_TOKEN }),
      OWNER,
    );

    expect(outcome).toMatchObject({ read: 2, unreachable: 0, failed: false });
    expect(calls.map((call) => [call.token, call.refs.length])).toEqual([
      [VIEWER_TOKEN, 2],
      [OPERATOR_TOKEN, 1],
    ]);
    expect((await readRow(1)).title).toBe("live title");
  });

  it("a row refused to both tokens waits the window unmarked", async () => {
    stubWithheldReads((token, ref) => {
      if (ref.prNumber !== 1) return stubFacts();
      return token === OPERATOR_TOKEN ? null : undefined;
    });
    await seedRows(2);

    const outcome = await refreshUrlPullRequests(
      deps({ fallbackToken: OPERATOR_TOKEN }),
      OWNER,
    );

    expect(outcome).toMatchObject({ read: 1, unreachable: 0, failed: false });
    const row = await readRow(1);
    expect(row.githubReadAt).toEqual(NOW);
    expect(row.githubUnreachableAt).toBeNull();
  });

  it("a rejected operator token leaves the viewer's answer standing", async () => {
    const calls = stubReads(() => null);
    vi.mocked(readPullRequestFacts).mockImplementation(
      async (octokit, refs) => {
        const { token } = octokit as unknown as TokenOctokit;
        calls.push({ token, refs });
        if (token === OPERATOR_TOKEN) {
          return {
            ok: false,
            error: { code: "forbidden", status: 403, message: "rejected" },
          };
        }
        const page = new Map<string, PullRequestFacts | null>();
        for (const ref of refs) page.set(getLiveReadKey(ref), null);
        return { ok: true, value: page };
      },
    );
    await seedRows(1);

    const outcome = await refreshUrlPullRequests(
      deps({ fallbackToken: OPERATOR_TOKEN }),
      OWNER,
    );

    expect(outcome).toMatchObject({ read: 0, unreachable: 1, failed: false });
    expect(calls.map((call) => call.token)).toEqual([
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
    vi.mocked(readPullRequestFacts).mockResolvedValue({
      ok: false,
      error: { code: "rate-limited", status: 403, message: "read failed" },
    });
    await seedRows(1);

    const outcome = await refreshUrlPullRequests(deps(), OWNER);

    expect(outcome).toMatchObject({ read: 0, failed: true });
    expect((await readRow(1)).githubReadAt).toBeNull();
    expect(log.warn).toHaveBeenCalledWith(
      "live read refused by GitHub, serving stored rows",
      { code: "rate-limited" },
    );
  });

  it("serves stored rows past the ceiling and finishes behind it", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.mocked(readPullRequestFacts).mockImplementation(async (_o, refs) => {
      await gate;
      const page = new Map<string, PullRequestFacts | null>();
      for (const ref of refs) page.set(getLiveReadKey(ref), stubFacts());
      return { ok: true, value: page };
    });
    await seedRows(1);

    const outcome = await refreshUrlPullRequests(deps({ waitMs: 5 }), OWNER);

    expect(outcome).toMatchObject({ timedOut: true, read: 0 });
    expect((await readRow(1)).githubReadAt).toBeNull();
    release?.();
    await vi.waitFor(async () => {
      expect((await readRow(1)).githubReadAt).toEqual(NOW);
    });
  });

  it("a caller arriving during a slow read joins it", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const calls = stubReads(() => stubFacts());
    vi.mocked(readPullRequestFacts).mockImplementation(async (_o, refs) => {
      calls.push({ token: VIEWER_TOKEN, refs });
      await gate;
      const page = new Map<string, PullRequestFacts | null>();
      for (const ref of refs) page.set(getLiveReadKey(ref), stubFacts());
      return { ok: true, value: page };
    });
    await seedRows(1);

    const first = refreshUrlPullRequests(deps({ waitMs: 5 }), OWNER);
    const second = refreshUrlPullRequests(deps({ waitMs: 5 }), OWNER);
    expect(await first).toMatchObject({ timedOut: true });
    expect(await second).toMatchObject({ timedOut: true });
    release?.();
    await vi.waitFor(async () => {
      expect((await readRow(1)).githubReadAt).toEqual(NOW);
    });

    expect(calls).toHaveLength(1);
  });

  it("another reader arriving during a slow read runs its own token", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const calls = stubReads(() => stubFacts());
    vi.mocked(readPullRequestFacts).mockImplementation(async (_o, refs) => {
      calls.push({ token: VIEWER_TOKEN, refs });
      await gate;
      const page = new Map<string, PullRequestFacts | null>();
      for (const ref of refs) page.set(getLiveReadKey(ref), stubFacts());
      return { ok: true, value: page };
    });
    await seedRows(1);

    const owner = refreshUrlPullRequests(deps({ waitMs: 5 }), OWNER);
    const other = refreshUrlPullRequests(
      deps({ waitMs: 5, reader: OTHER_READER }),
      OWNER,
    );
    expect(await owner).toMatchObject({ timedOut: true });
    expect(await other).toMatchObject({ timedOut: true });
    release?.();
    await vi.waitFor(async () => {
      expect((await readRow(1)).githubReadAt).toEqual(NOW);
    });

    expect(calls).toHaveLength(2);
  });
});

describe("refreshUrlPullRequest", () => {
  it("reads the one row by the verified name when it is due", async () => {
    const calls = stubReads(() => stubFacts());
    await seedRows(2, "stale/label");

    const first = await refreshUrlPullRequest(deps(), OWNER, REPO, 2, "o/r");
    const again = await refreshUrlPullRequest(deps(), OWNER, REPO, 2, "o/r");

    expect(first).toMatchObject({ read: 1 });
    expect(again).toMatchObject({ read: 0 });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.refs).toEqual([{ owner: "o", repo: "r", prNumber: 2 }]);
    expect((await readRow(1)).githubReadAt).toBeNull();
  });
});
