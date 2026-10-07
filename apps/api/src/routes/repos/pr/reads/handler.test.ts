import { randomBytes } from "node:crypto";
import { Hono } from "hono";
import {
  GitHubApiErrorCodes,
  RepoFileKinds,
  fetchCompareDiff,
  fetchPullRequest,
  getRepoFile,
  listOpenPullRequests,
} from "github";
import type * as githubModule from "github";
import type { Logger } from "logging";
import {
  createEnvKeyProvider,
  encryptToken,
  isGrantRowId,
  isInstallationId,
  isRepoId,
  isReviewerId,
  parseTenantContext,
  createTenantRepository,
  WriteClassifications,
  type RepoId,
} from "persistence";
import { PrStates } from "types/pull-requests";
import { createPgliteHarness, type PgliteHarness } from "persistence/testing";
import type { Result } from "types/utils";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createTestUserOctokit } from "../../../../../test/fixtures";
import { createErrorHandler } from "../../../../shared-errors/on-error";
import type * as refreshModule from "../../../auth/session/logic/refresh";
import {
  AuthChannels,
  type AuthRouteDeps,
  type ViewerPrincipal,
} from "../../../auth/session/types";
import { refreshSessionToken } from "../../../auth/session/logic/refresh";
import type { AuthzEnv } from "../../../authz";
import type { PullRequestInfo } from "github";
import type { OpenPullRequest } from "brief-core/pr-stack";
import { createTtlCache, type TtlCache } from "../../../ttl-cache";
import { FILE_BLOB_CACHE_MAX_ENTRIES } from "./consts";
import { buildFileBlobCacheKey } from "./logic/keys";
import { createReadsHandlers } from "./handler";

vi.mock("github", async (importOriginal) => ({
  ...(await importOriginal<typeof githubModule>()),
  fetchCompareDiff: vi.fn(),
  fetchPullRequest: vi.fn(),
  getRepoFile: vi.fn(),
  listOpenPullRequests: vi.fn(),
}));

vi.mock("../../../auth/session/logic/refresh", async (importOriginal) => ({
  ...(await importOriginal<typeof refreshModule>()),
  refreshSessionToken: vi.fn(),
}));

const KEY_REF = "SESSION_KEY_TEST";
const keyProvider = createEnvKeyProvider({
  [KEY_REF]: randomBytes(32).toString("base64"),
});

const log: Logger = {
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  child: () => log,
};

function brand<T extends bigint>(
  value: bigint,
  guard: (v: bigint) => v is T,
): T {
  if (!guard(value)) {
    throw new Error("unbrandable fixture value");
  }
  return value;
}

let harness: PgliteHarness;
let lastSessionTokenHash = "";
let repoId: RepoId;
const PR_NUMBER = 7;
const MERGED_PR_NUMBER = 9;
const BARE_MERGED_PR_NUMBER = 11;
const FRESH_PR_NUMBER = 21;
const LAGGING_PR_NUMBER = 13;
const STILL_PARENT_PR_NUMBER = 15;
const FETCHED_PR_NUMBER = 17;
const INSTALLATION_ID = 606n;
const MERGED_AT = new Date("2026-09-20T09:00:00Z");
const RECORDED_AT = new Date("2026-09-19T12:00:00Z");

beforeAll(async () => {
  harness = await createPgliteHarness();
  repoId = brand(7654n, isRepoId);
  const installationId = brand(INSTALLATION_ID, isInstallationId);
  await createTenantRepository(
    harness.handle,
    parseTenantContext({
      installationId,
    }),
  ).pullRequests.upsert({
    repoId,
    prNumber: PR_NUMBER,
    repoSlug: "acme/app",
    title: "Add thing",
    state: PrStates.OPEN,
  });
  await createTenantRepository(
    harness.handle,
    parseTenantContext({
      installationId,
    }),
  ).pullRequests.upsert({
    repoId,
    prNumber: MERGED_PR_NUMBER,
    repoSlug: "acme/app",
    title: "Merged thing",
    state: PrStates.MERGED,
    closedAt: MERGED_AT,
    purgeAfter: null,
  });
  await getTenantPullRequests().upsert({
    repoId,
    prNumber: BARE_MERGED_PR_NUMBER,
    repoSlug: "acme/app",
    title: "Merged bare",
    state: PrStates.MERGED,
    closedAt: MERGED_AT,
    purgeAfter: null,
  });
  await getTenantPullRequests().upsert({
    repoId,
    prNumber: LAGGING_PR_NUMBER,
    repoSlug: "acme/app",
    title: "Row still open",
    state: PrStates.OPEN,
  });
  await getTenantPullRequests().upsert({
    repoId,
    prNumber: STILL_PARENT_PR_NUMBER,
    repoSlug: "acme/app",
    title: "Merged parent",
    state: PrStates.MERGED,
    closedAt: MERGED_AT,
    purgeAfter: null,
  });
  await getTenantPullRequests().upsert({
    repoId,
    prNumber: FETCHED_PR_NUMBER,
    repoSlug: "acme/app",
    title: "Fetched",
    state: PrStates.OPEN,
  });
  await getTenantPullRequests().upsert({
    repoId,
    prNumber: FRESH_PR_NUMBER,
    repoSlug: "acme/app",
    title: "Fresh",
    state: PrStates.OPEN,
  });
});

function getTenantPullRequests() {
  return createTenantRepository(
    harness.handle,
    parseTenantContext({
      installationId: brand(INSTALLATION_ID, isInstallationId),
    }),
  ).pullRequests;
}

async function readRow(prNumber: number) {
  const row = await getTenantPullRequests().getByNumber(repoId, prNumber);
  if (row === undefined) {
    throw new Error("fixture row missing");
  }
  return row;
}
afterAll(async () => {
  await harness.close();
});

async function buildApp(
  ciphertextOverride?: string,
  fileCacheOverride?: TtlCache<readonly string[]>,
  openPullsCacheOverride?: TtlCache<readonly OpenPullRequest[]>,
): Promise<Hono<AuthzEnv>> {
  const sealed = await encryptToken(keyProvider, KEY_REF, "stale-token");
  if (!sealed.ok) {
    throw new Error("fixture seal failed");
  }
  lastSessionTokenHash = `hash-${randomBytes(4).toString("hex")}`;
  const session: ViewerPrincipal = {
    id: 1n,
    sessionTokenHash: lastSessionTokenHash,
    reviewerId: brand(42n, isReviewerId),
    reviewerLogin: "octocat",
    grantId: brand(7n, isGrantRowId),
    expiresAt: new Date(Date.now() + 60_000),
    createdAt: new Date(),
    ghTokenCiphertext: ciphertextOverride ?? sealed.value,
    keyRef: KEY_REF,
    scope: WriteClassifications.EXTERNAL_WRITE,
    channel: AuthChannels.COOKIE,
  };
  const deps: AuthRouteDeps = {
    handle: harness.handle,
    auth: {
      oauthClientId: "client-id",
      oauthClientSecret: "client-secret",
      keyProvider,
      sessionKeyRef: KEY_REF,
      publicBaseUrl: "https://example.test",
      createUserOctokit: createTestUserOctokit,
    },
  };
  const app = new Hono<AuthzEnv>();
  app.onError(createErrorHandler<AuthzEnv>(log));
  app.use(async (c, next) => {
    c.set("logger", log);
    c.set("ctx", { installationId: brand(INSTALLATION_ID, isInstallationId) });
    c.set("session", session);
    c.set("repoId", repoId);
    c.set("repoFullName", "acme/app");
    c.set("viewerCanPush", true);
    await next();
  });
  const handlers = createReadsHandlers(
    deps,
    createTtlCache<string>(10),
    fileCacheOverride ?? createTtlCache<readonly string[]>(10),
    openPullsCacheOverride ?? createTtlCache<readonly OpenPullRequest[]>(10),
  );
  app.get("/:prNumber/diff", handlers.readDiff);
  app.get("/:prNumber/file-range", handlers.readFileRange);
  app.get("/:prNumber/stack", handlers.readStack);
  return app;
}

function deriveDeniedCode(status: number): githubModule.GitHubApiErrorCode {
  if (status === 401) {
    return GitHubApiErrorCodes.UNAUTHORIZED;
  }
  if (status === 404) {
    return GitHubApiErrorCodes.NOT_FOUND;
  }
  return GitHubApiErrorCodes.REQUEST_FAILED;
}

function denied<T = string>(
  status: number,
): Result<T, githubModule.GitHubApiError> {
  const code = deriveDeniedCode(status);

  return { ok: false, error: { code, status, message: "denied" } };
}

const DIFF_PATH = `/${PR_NUMBER}/diff?base=aaa&head=bbb`;

beforeEach(() => {
  vi.mocked(fetchCompareDiff).mockReset();
  vi.mocked(fetchPullRequest).mockReset();
  vi.mocked(getRepoFile).mockReset();
  vi.mocked(listOpenPullRequests).mockReset();
  vi.mocked(refreshSessionToken).mockReset();
});

describe("diff proxy posture split", () => {
  it("401 with a FAILED refresh stays a re-login 401", async () => {
    vi.mocked(fetchCompareDiff).mockResolvedValue(denied(401));
    vi.mocked(refreshSessionToken).mockResolvedValue({
      ok: false,
      error: { code: "refresh-failed", message: "refresh failed" },
    });
    const res = await (await buildApp()).request(DIFF_PATH);
    expect(res.status).toBe(401);
    expect(fetchCompareDiff).toHaveBeenCalledTimes(1);
  });

  it("401 after a SUCCESSFUL refresh and retry is an upstream 502", async () => {
    vi.mocked(fetchCompareDiff).mockResolvedValue(denied(401));
    vi.mocked(refreshSessionToken).mockImplementation(async (_d, session) => ({
      ok: true,
      value: { session, accessToken: "rotated-token" },
    }));
    const res = await (await buildApp()).request(DIFF_PATH);
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ code: "github-unavailable" });
    expect(fetchCompareDiff).toHaveBeenCalledTimes(2);
    expect(refreshSessionToken).toHaveBeenCalledTimes(1);
  });

  it("compare NOT_FOUND keeps the 404 collapse", async () => {
    vi.mocked(fetchCompareDiff).mockResolvedValue(denied(404));
    const res = await (await buildApp()).request(DIFF_PATH);
    expect(res.status).toBe(404);
  });

  it("406 surfaces as the permanent 413 diff-too-large", async () => {
    vi.mocked(fetchCompareDiff).mockResolvedValue(denied(406));
    const res = await (await buildApp()).request(DIFF_PATH);
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ code: "diff-too-large" });
  });

  it("an unreadable stored token is a re-login 401 with no GitHub call", async () => {
    const res = await (await buildApp("not-a-ciphertext")).request(DIFF_PATH);
    expect(res.status).toBe(401);
    expect(fetchCompareDiff).not.toHaveBeenCalled();
  });
});

const HEAD_SHA = `${"0".repeat(39)}a`;
const RANGE_PATH = `/${PR_NUMBER}/file-range?ref=${HEAD_SHA}&path=src/app.ts&from=2&to=3`;

function stubFile(
  content: string,
): Result<githubModule.RepoFileResult, githubModule.GitHubApiError> {
  return {
    ok: true,
    value: {
      kind: RepoFileKinds.FILE,
      content,
      blobSha: "blob-sha",
      size: content.length,
    },
  };
}

describe("file range read", () => {
  it("serves the asked window and the file's line count", async () => {
    vi.mocked(getRepoFile).mockResolvedValue(stubFile("a\nb\nc\nd\n"));
    const res = await (await buildApp()).request(RANGE_PATH);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({
      path: "src/app.ts",
      ref: HEAD_SHA,
      from: 2,
      to: 3,
      lines: ["b", "c"],
      totalLines: 4,
    });
  });

  it("reads the blob once for two ranges of the same file", async () => {
    vi.mocked(getRepoFile).mockResolvedValue(stubFile("a\nb\nc\nd\n"));
    const app = await buildApp();
    const first = await app.request(RANGE_PATH);
    const second = await app.request(
      `/${PR_NUMBER}/file-range?ref=${HEAD_SHA}&path=src/app.ts&from=1&to=1`,
    );
    expect(first.status).toBe(200);
    expect(await second.json()).toMatchObject({ lines: ["a"] });
    expect(getRepoFile).toHaveBeenCalledTimes(1);
  });

  it("caches the split lines, so a second range never re-splits", async () => {
    vi.mocked(getRepoFile).mockResolvedValue(stubFile("a\nb\nc\nd\n"));
    const fileCache = createTtlCache<readonly string[]>(
      FILE_BLOB_CACHE_MAX_ENTRIES,
    );
    const app = await buildApp(undefined, fileCache);
    await app.request(RANGE_PATH);
    const key = buildFileBlobCacheKey({
      sessionTokenHash: lastSessionTokenHash,
      repoId,
      ref: HEAD_SHA,
      path: "src/app.ts",
    });
    expect(fileCache.get(key)).toEqual(["a", "b", "c", "d"]);
  });

  it("holds its entry cap, so one reader cannot pin the heap", () => {
    const fileCache = createTtlCache<readonly string[]>(
      FILE_BLOB_CACHE_MAX_ENTRIES,
    );
    const expiresAt = Date.now() + 60_000;
    const overflow = FILE_BLOB_CACHE_MAX_ENTRIES + 10;
    for (let index = 0; index < overflow; index += 1) {
      fileCache.set(`key-${String(index)}`, ["line"], expiresAt);
    }
    expect(fileCache.get("key-0")).toBeUndefined();
    expect(fileCache.get(`key-${String(overflow - 1)}`)).toEqual(["line"]);
  });

  it("refuses a span wider than one read may serve", async () => {
    const res = await (
      await buildApp()
    ).request(
      `/${PR_NUMBER}/file-range?ref=${HEAD_SHA}&path=src/app.ts&from=1&to=401`,
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "invalid-request" });
    expect(getRepoFile).not.toHaveBeenCalled();
  });

  it("refuses a branch name in place of a commit SHA", async () => {
    const res = await (
      await buildApp()
    ).request(`/${PR_NUMBER}/file-range?ref=main&path=src/app.ts&from=1&to=2`);
    expect(res.status).toBe(400);
    expect(getRepoFile).not.toHaveBeenCalled();
  });

  it("tells an absent path apart from a repo the reader cannot see", async () => {
    vi.mocked(getRepoFile).mockResolvedValue({
      ok: true,
      value: { kind: RepoFileKinds.ABSENT },
    });
    const res = await (await buildApp()).request(RANGE_PATH);
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: "file-not-found" });
  });

  it("never serves one session the blob another session cached", async () => {
    vi.mocked(getRepoFile).mockResolvedValue(stubFile("a\nb\nc\nd\n"));
    const fileCache = createTtlCache<readonly string[]>(
      FILE_BLOB_CACHE_MAX_ENTRIES,
    );
    const sessionA = await buildApp(undefined, fileCache);
    const sessionB = await buildApp(undefined, fileCache);
    await sessionA.request(RANGE_PATH);
    await sessionB.request(RANGE_PATH);
    expect(getRepoFile).toHaveBeenCalledTimes(2);
  });

  it("answers 413 for a blob over the byte cap", async () => {
    vi.mocked(getRepoFile).mockResolvedValue({
      ok: true,
      value: { kind: RepoFileKinds.TOO_LARGE, blobSha: "s", size: 9_000_000 },
    });
    const res = await (await buildApp()).request(RANGE_PATH);
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ code: "file-too-large" });
  });

  it("answers 400 for a blob that is not text", async () => {
    vi.mocked(getRepoFile).mockResolvedValue(stubFile("a\u0000b"));
    const res = await (await buildApp()).request(RANGE_PATH);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "file-not-text" });
  });

  it("answers 400 for a blob that does not decode, with no retry", async () => {
    vi.mocked(getRepoFile).mockResolvedValue({
      ok: false,
      error: {
        code: GitHubApiErrorCodes.NOT_TEXT,
        message: "not text",
      },
    });
    const res = await (await buildApp()).request(RANGE_PATH);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "file-not-text" });
    expect(getRepoFile).toHaveBeenCalledTimes(1);
  });

  it("answers 400 for a submodule pointer, with no retry", async () => {
    vi.mocked(getRepoFile).mockResolvedValue({
      ok: false,
      error: {
        code: GitHubApiErrorCodes.NOT_A_BLOB,
        message: "not a blob",
      },
    });
    const res = await (await buildApp()).request(RANGE_PATH);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "file-not-text" });
    expect(getRepoFile).toHaveBeenCalledTimes(1);
  });

  const denials = [
    ["not found", GitHubApiErrorCodes.NOT_FOUND, 404],
    ["forbidden", GitHubApiErrorCodes.FORBIDDEN, 403],
  ] as const;

  // The BARE 404, never file-not-found: a reader must not be able to tell a
  // repo they cannot see from a path that is not there.
  it.each(denials)(
    "collapses a %s denial to the gate's bare 404",
    async (_label, code, status) => {
      vi.mocked(getRepoFile).mockResolvedValue({
        ok: false,
        error: { code, status, message: "denied" },
      });
      const res = await (await buildApp()).request(RANGE_PATH);
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ code: "not-found" });
    },
  );

  it("surfaces a rate-limited read as an upstream 502", async () => {
    vi.mocked(getRepoFile).mockResolvedValue({
      ok: false,
      error: {
        code: GitHubApiErrorCodes.RATE_LIMITED,
        status: 403,
        message: "denied",
      },
    });
    const res = await (await buildApp()).request(RANGE_PATH);
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ code: "github-unavailable" });
  });
});

const STACK_PATH = `/${PR_NUMBER}/stack`;
const REPO = { owner: "acme", repo: "app" };

function stubOpenPull(
  number: number,
  headRef: string,
  baseRef: string,
): OpenPullRequest {
  return {
    number,
    title: `PR ${number}`,
    headRef,
    baseRef,
    headRepo: REPO,
    baseRepo: REPO,
  };
}

function stubFetchedPull(
  number: number,
  state: "open" | "closed",
): Result<PullRequestInfo, githubModule.GitHubApiError> {
  return {
    ok: true,
    value: {
      repoId,
      repoFullName: "acme/app",
      headSha: "head",
      headRef: `feature/${String(number)}`,
      baseSha: "base",
      baseRef: "main",
      updatedAt: MERGED_AT,
      state,
      draft: false,
      merged: state === "closed",
      title: `PR ${String(number)}`,
      body: "",
      htmlUrl: `https://github.com/acme/app/pull/${String(number)}`,
      commitCount: 1,
      authorLogin: "octocat",
      closedAt: MERGED_AT,
      headRepo: REPO,
      baseRepo: REPO,
    },
  };
}

function stubOpenList(
  pulls: readonly OpenPullRequest[],
): Result<OpenPullRequest[], githubModule.GitHubApiError> {
  return { ok: true, value: [...pulls] };
}

describe("live stack read", () => {
  it("derives the stack from the open list when the PR is in it", async () => {
    vi.mocked(listOpenPullRequests).mockResolvedValue(
      stubOpenList([
        stubOpenPull(6, "feature/base", "main"),
        stubOpenPull(PR_NUMBER, "feature/mid", "feature/base"),
        stubOpenPull(8, "feature/tip", "feature/mid"),
      ]),
    );
    const res = await (await buildApp()).request(STACK_PATH);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      stack: {
        members: [
          { number: 6, title: "PR 6" },
          { number: PR_NUMBER, title: `PR ${PR_NUMBER}` },
          { number: 8, title: "PR 8" },
        ],
        index: 2,
      },
    });
    expect(fetchPullRequest).not.toHaveBeenCalled();
  });

  it("answers a null stack for a PR with no open neighbours", async () => {
    vi.mocked(listOpenPullRequests).mockResolvedValue(
      stubOpenList([stubOpenPull(PR_NUMBER, "feature/solo", "main")]),
    );
    const res = await (await buildApp()).request(STACK_PATH);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ stack: null });
  });

  it("fetches a PR missing from the open list for its refs", async () => {
    vi.mocked(listOpenPullRequests).mockResolvedValue(
      stubOpenList([
        stubOpenPull(18, "feature/18", `feature/${FETCHED_PR_NUMBER}`),
      ]),
    );
    vi.mocked(fetchPullRequest).mockResolvedValue(
      stubFetchedPull(FETCHED_PR_NUMBER, "closed"),
    );
    const res = await (await buildApp()).request(`/${FETCHED_PR_NUMBER}/stack`);
    expect(res.status).toBe(200);
    // A closed PR serves its record, which the resolve just became.
    expect(await res.json()).toEqual({
      stack: {
        members: [
          { number: FETCHED_PR_NUMBER, title: `PR ${FETCHED_PR_NUMBER}` },
          { number: 18, title: "PR 18" },
        ],
        index: 1,
      },
      asOf: expect.any(String),
    });
    expect(fetchPullRequest).toHaveBeenCalledTimes(1);
  });

  it("reuses the open list across reads in one session", async () => {
    vi.mocked(listOpenPullRequests).mockResolvedValue(
      stubOpenList([
        stubOpenPull(PR_NUMBER, "feature/mid", "main"),
        stubOpenPull(8, "feature/tip", "feature/mid"),
      ]),
    );
    const app = await buildApp();
    expect((await app.request(STACK_PATH)).status).toBe(200);
    expect((await app.request(STACK_PATH)).status).toBe(200);
    expect(listOpenPullRequests).toHaveBeenCalledTimes(1);
  });

  it("re-reads the open list once the cached copy is ten seconds old", async () => {
    const insideTtlMs = 9_000;
    const pastTtlMs = 11_000;
    vi.mocked(listOpenPullRequests).mockResolvedValue(
      stubOpenList([
        stubOpenPull(PR_NUMBER, "feature/mid", "main"),
        stubOpenPull(8, "feature/tip", "feature/mid"),
      ]),
    );
    const app = await buildApp();
    const start = Date.now();
    vi.useFakeTimers({ toFake: ["Date"], now: start });
    try {
      expect((await app.request(STACK_PATH)).status).toBe(200);

      vi.setSystemTime(start + insideTtlMs);
      expect((await app.request(STACK_PATH)).status).toBe(200);
      expect(listOpenPullRequests).toHaveBeenCalledTimes(1);

      vi.setSystemTime(start + pastTtlMs);
      expect((await app.request(STACK_PATH)).status).toBe(200);
      expect(listOpenPullRequests).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("records a resolved stack on the pull request row", async () => {
    vi.mocked(listOpenPullRequests).mockResolvedValue(
      stubOpenList([
        stubOpenPull(FRESH_PR_NUMBER, "feature/fresh", "main"),
        stubOpenPull(22, "feature/tip", "feature/fresh"),
      ]),
    );
    const before = Date.now();

    const res = await (await buildApp()).request(`/${FRESH_PR_NUMBER}/stack`);

    expect(res.status).toBe(200);
    const row = await readRow(FRESH_PR_NUMBER);
    expect(row.stack).toEqual({
      members: [
        { number: FRESH_PR_NUMBER, title: `PR ${FRESH_PR_NUMBER}` },
        { number: 22, title: "PR 22" },
      ],
      index: 1,
    });
    expect(row.stackReadAt?.getTime()).toBeGreaterThanOrEqual(before);
  });

  it("a null resolve on an open PR keeps the recorded stack and serves null", async () => {
    const recorded = { members: [{ number: PR_NUMBER, title: "x" }], index: 1 };
    await getTenantPullRequests().recordStack((await readRow(PR_NUMBER)).id, {
      stack: recorded,
      readAt: RECORDED_AT,
    });
    vi.mocked(listOpenPullRequests).mockResolvedValue(
      stubOpenList([stubOpenPull(PR_NUMBER, "feature/solo", "main")]),
    );

    const res = await (await buildApp()).request(STACK_PATH);

    expect(await res.json()).toEqual({ stack: null });
    const row = await readRow(PR_NUMBER);
    expect(row.stack).toEqual(recorded);
    expect(row.stackReadAt).toEqual(RECORDED_AT);
  });

  it("serves the recorded stack with its read time for a merged PR", async () => {
    const recorded = {
      members: [
        { number: MERGED_PR_NUMBER, title: "Merged thing" },
        { number: 10, title: "PR 10" },
      ],
      index: 1,
    };
    await getTenantPullRequests().recordStack(
      (await readRow(MERGED_PR_NUMBER)).id,
      { stack: recorded, readAt: RECORDED_AT },
    );
    vi.mocked(listOpenPullRequests).mockResolvedValue(stubOpenList([]));
    vi.mocked(fetchPullRequest).mockResolvedValue({
      ok: true,
      value: {
        repoId,
        repoFullName: "acme/app",
        headSha: "head",
        headRef: "feature/merged",
        baseSha: "base",
        baseRef: "main",
        updatedAt: MERGED_AT,
        state: "closed",
        draft: false,
        merged: true,
        title: "Merged thing",
        body: "",
        htmlUrl: "https://github.com/acme/app/pull/9",
        commitCount: 1,
        authorLogin: "octocat",
        closedAt: MERGED_AT,
        headRepo: REPO,
        baseRepo: REPO,
      },
    });

    const res = await (await buildApp()).request(`/${MERGED_PR_NUMBER}/stack`);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      stack: recorded,
      asOf: RECORDED_AT.toISOString(),
    });
  });

  it("keeps a recorded chain the resolve only shrank by merged ancestors", async () => {
    const recorded = {
      members: [
        { number: 6, title: "PR 6" },
        { number: PR_NUMBER, title: `PR ${PR_NUMBER}` },
        { number: 8, title: "PR 8" },
      ],
      index: 2,
    };
    await getTenantPullRequests().recordStack((await readRow(PR_NUMBER)).id, {
      stack: recorded,
      readAt: RECORDED_AT,
    });
    vi.mocked(listOpenPullRequests).mockResolvedValue(
      stubOpenList([
        stubOpenPull(PR_NUMBER, "feature/mid", "main"),
        stubOpenPull(8, "feature/tip", "feature/mid"),
      ]),
    );

    const res = await (await buildApp()).request(STACK_PATH);

    expect(await res.json()).toEqual({
      stack: {
        members: [
          { number: PR_NUMBER, title: `PR ${PR_NUMBER}` },
          { number: 8, title: "PR 8" },
        ],
        index: 1,
      },
    });
    const row = await readRow(PR_NUMBER);
    expect(row.stack).toEqual(recorded);
    expect(row.stackReadAt).toEqual(RECORDED_AT);
  });

  it("a merged PR a child still points at serves the record, not the chain", async () => {
    const recorded = {
      members: [
        { number: 6, title: "PR 6" },
        {
          number: STILL_PARENT_PR_NUMBER,
          title: `PR ${STILL_PARENT_PR_NUMBER}`,
        },
        { number: 16, title: "PR 16" },
      ],
      index: 2,
    };
    await getTenantPullRequests().recordStack(
      (await readRow(STILL_PARENT_PR_NUMBER)).id,
      { stack: recorded, readAt: RECORDED_AT },
    );
    vi.mocked(listOpenPullRequests).mockResolvedValue(
      stubOpenList([
        stubOpenPull(16, "feature/16", `feature/${STILL_PARENT_PR_NUMBER}`),
      ]),
    );
    vi.mocked(fetchPullRequest).mockResolvedValue(
      stubFetchedPull(STILL_PARENT_PR_NUMBER, "closed"),
    );

    const res = await (
      await buildApp()
    ).request(`/${STILL_PARENT_PR_NUMBER}/stack`);

    expect(await res.json()).toEqual({
      stack: recorded,
      asOf: RECORDED_AT.toISOString(),
    });
    expect((await readRow(STILL_PARENT_PR_NUMBER)).stackReadAt).toEqual(
      RECORDED_AT,
    );
  });

  it("a merged PR without a record answers null", async () => {
    vi.mocked(listOpenPullRequests).mockResolvedValue(stubOpenList([]));
    vi.mocked(fetchPullRequest).mockResolvedValue(
      stubFetchedPull(BARE_MERGED_PR_NUMBER, "closed"),
    );

    const res = await (
      await buildApp()
    ).request(`/${BARE_MERGED_PR_NUMBER}/stack`);

    expect(await res.json()).toEqual({ stack: null });
  });

  it("a record the schema rejects answers null", async () => {
    await getTenantPullRequests().recordStack(
      (await readRow(BARE_MERGED_PR_NUMBER)).id,
      { stack: { members: "nope" }, readAt: RECORDED_AT },
    );
    vi.mocked(listOpenPullRequests).mockResolvedValue(stubOpenList([]));
    vi.mocked(fetchPullRequest).mockResolvedValue(
      stubFetchedPull(BARE_MERGED_PR_NUMBER, "closed"),
    );

    const res = await (
      await buildApp()
    ).request(`/${BARE_MERGED_PR_NUMBER}/stack`);

    expect(await res.json()).toEqual({ stack: null });
  });

  it("serves the record when GitHub says merged but the row lags open", async () => {
    const recorded = {
      members: [
        { number: LAGGING_PR_NUMBER, title: "Row still open" },
        { number: 14, title: "PR 14" },
      ],
      index: 1,
    };
    await getTenantPullRequests().recordStack(
      (await readRow(LAGGING_PR_NUMBER)).id,
      { stack: recorded, readAt: RECORDED_AT },
    );
    vi.mocked(listOpenPullRequests).mockResolvedValue(stubOpenList([]));
    vi.mocked(fetchPullRequest).mockResolvedValue(
      stubFetchedPull(LAGGING_PR_NUMBER, "closed"),
    );

    const res = await (await buildApp()).request(`/${LAGGING_PR_NUMBER}/stack`);

    expect(await res.json()).toEqual({
      stack: recorded,
      asOf: RECORDED_AT.toISOString(),
    });
  });

  it("keeps the 404 collapse when the list is denied", async () => {
    vi.mocked(listOpenPullRequests).mockResolvedValue(
      denied<OpenPullRequest[]>(404),
    );
    const res = await (await buildApp()).request(STACK_PATH);
    expect(res.status).toBe(404);
  });

  it("surfaces an upstream list failure as 502", async () => {
    vi.mocked(listOpenPullRequests).mockResolvedValue(
      denied<OpenPullRequest[]>(500),
    );
    const res = await (await buildApp()).request(STACK_PATH);
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ code: "github-unavailable" });
  });
});
