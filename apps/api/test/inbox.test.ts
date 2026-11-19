// GET /api/inbox over PGlite with GitHub on the `github/testing` fake: the
// envelope across an installation and the viewer's own url rows, the
// defaults, a page past the end, the signed-out and upstream-failure
// postures, and the live read before the list.
import {
  CredentialKinds,
  FakeFactsHidings,
  FakeFailures,
  makeFakeGitHub,
  type FakeGitHub,
} from "github/testing";
import {
  createArtifactStore,
  createTenantRepository,
  isInstallationId,
  isRepoId,
  isReviewerId,
  type AppDatabase,
  type KeyProvider,
  type PullRequestUpsertInput,
  type ReviewerId,
  type ScopeContext,
} from "persistence";
import { InboxQueryBounds } from "contract";
import { PrStates } from "types/pull-requests";
import type { Mutable } from "types/utils";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp, type ApiApp } from "../src/index";
import { INBOX_PAGE_SIZE } from "../src/routes/wire-bounds";
import { resetLiveReadMemory } from "../src/routes/live-read";
import { testLogger, testLogging, type TestLogging } from "./logging";
import {
  INSTALLATION_ID,
  SECRET,
  buildOperatorToken,
  createKeyProvider,
  SAME_ORIGIN_HEADERS,
} from "./fixtures";
import { spyPullRequestLookups } from "./pull-request-lookups";
import { seedSignIn } from "./sign-in";
import {
  UNUSED_INSTALLATION_DEPS,
  buildFakeAuthDeps,
  listFakeCallTokens,
  makeFakePullRequestInfo,
  makeOAuthErrorBody,
  stubNoNetwork,
  stubRefusedTokenRefresh,
  stubTokenRefreshAnswer,
} from "./reviewer-github";
import { registerSharedPglite } from "./shared-pglite";
import { STORED_BODY_VERSION } from "brief-core/artifact";

const OPERATOR_PAT = "ghp_OPERATOR_PAT";
const OTHER_INSTALLATION_ID = 111222;
const REPO_A = 424242;
const REPO_URL = 535353;
const REPO_PRIVATE = 646464;
const HEAD = "a".repeat(40);
const APP_SLUG = "mergebrief-test";
const REPO = { owner: "o", repo: "r" };
const URL_PR_NUMBER = 7;

function brand<T extends bigint>(
  guard: (v: bigint) => v is T,
  value: number,
): T {
  const asBigInt = BigInt(value);
  if (!guard(asBigInt)) {
    throw new Error("bad branded id");
  }
  return asBigInt;
}

const REVIEWER: ReviewerId = brand(isReviewerId, 555);
const TENANT: ScopeContext = {
  installationId: brand(isInstallationId, INSTALLATION_ID),
};
const OTHER_TENANT: ScopeContext = {
  installationId: brand(isInstallationId, OTHER_INSTALLATION_ID),
};
const OWNER: ScopeContext = { ownerUserId: REVIEWER };

interface OpenListEntry {
  readonly number: number;
  readonly head: string;
  readonly base: string;
}

interface InboxGitHub {
  /** The open pull requests GitHub lists for `o/r`. */
  readonly openList?: readonly OpenListEntry[];
  /** Repositories the walk reports the viewer administers. */
  readonly adminRepoIds?: readonly number[];
}

/**
 * The viewer reaches the suites' installation, whose walk holds `o/r`; the
 * repo's open list holds `openList`, and no repo is listed without one.
 */
function arrangeGitHub(fake: FakeGitHub, options: InboxGitHub = {}): void {
  const viewerIsAdmin = options.adminRepoIds?.includes(REPO_A) ?? false;
  fake.addInstallation(
    {
      installationId: brand(isInstallationId, INSTALLATION_ID),
      accountLogin: `org-${INSTALLATION_ID}`,
    },
    new Map([[brand(isRepoId, REPO_A), { fullName: "o/r", viewerIsAdmin }]]),
  );
  for (const entry of options.openList ?? []) {
    const info = {
      ...makeFakePullRequestInfo({ repoId: REPO_A }),
      title: `PR ${entry.number}`,
      headRef: entry.head,
      baseRef: entry.base,
    };
    fake.addPullRequest({ ...REPO, prNumber: entry.number }, { info });
  }
}

/** The pasted pull request as GitHub holds it now, for the live read. */
function arrangeLiveUrlPull(fake: FakeGitHub): void {
  const info = {
    ...makeFakePullRequestInfo({ repoId: REPO_URL }),
    repoFullName: "o/url",
    title: "Live title",
    headSha: HEAD,
    updatedAt: new Date("2026-09-20T10:00:00Z"),
  };
  fake.addPullRequest({ ...REPO, prNumber: URL_PR_NUMBER }, { info });
}

/** The live read shows the viewer's own token no pull request at all. */
function hideLiveReadFromViewer(fake: FakeGitHub): void {
  fake.hideFacts(
    { ...REPO, prNumber: URL_PR_NUMBER },
    CredentialKinds.REVIEWER,
    FakeFactsHidings.NOT_SHOWN,
  );
}

function countLiveReads(fake: FakeGitHub): number {
  return fake.listCalls("readPullRequestFacts").length;
}

interface SeedInput {
  readonly ctx: ScopeContext;
  readonly repoId: number;
  readonly prNumber: number;
  readonly title?: string;
  readonly authorLogin?: string;
  readonly updatedAt?: Date;
  readonly draft?: boolean;
  /** Stamp the row as read now, so the live read leaves it alone. */
  readonly fresh?: boolean;
}

async function seedPr(handle: AppDatabase, input: SeedInput) {
  const upsert: Mutable<PullRequestUpsertInput> = {
    repoId: brand(isRepoId, input.repoId),
    prNumber: input.prNumber,
    repoSlug: "o/r",
    title: input.title ?? `PR ${input.prNumber}`,
    authorLogin: input.authorLogin ?? "someone",
    state: PrStates.OPEN,
    githubUpdatedAt: input.updatedAt ?? new Date("2026-09-01T00:00:00Z"),
  };
  if (input.fresh === true) {
    upsert.liveRead = { readAt: new Date(), headSha: HEAD };
  }
  if (input.draft !== undefined) {
    upsert.draft = input.draft;
  }
  return createTenantRepository(handle, input.ctx).pullRequests.upsert(upsert);
}

async function seedBrief(
  handle: AppDatabase,
  ctx: ScopeContext,
  pullRequestId: Parameters<
    ReturnType<typeof createArtifactStore>["briefs"]["write"]
  >[0]["pullRequestId"],
  body = "{}",
): Promise<void> {
  await createArtifactStore(handle, ctx).briefs.write({
    pullRequestId,
    baseSha: "b".repeat(40),
    headSha: HEAD,
    headIndex: 1,
    commitCount: 1,
    provider: "p",
    model: "m",
    effort: "e",
    bodyVersion: STORED_BODY_VERSION,
    body,
    usedGroupIds: [],
  });
}

async function recordStack(
  handle: AppDatabase,
  ctx: ScopeContext,
  pullRequestId: Parameters<
    ReturnType<typeof createTenantRepository>["pullRequests"]["recordStack"]
  >[0],
  stack: unknown,
): Promise<void> {
  const written = await createTenantRepository(
    handle,
    ctx,
  ).pullRequests.recordStack(pullRequestId, { stack, readAt: new Date() });
  if (written === undefined) {
    throw new Error("recordStack found no row in seed");
  }
}

interface InboxBody {
  items: Array<Record<string, unknown>>;
  page: number;
  pageSize: number;
  total: number;
  searchMatchTotal: number;
  archivedSearchMatchTotal: number;
  counts: Record<string, number>;
  viewer: Record<string, unknown>;
  reachableInstallations: Array<Record<string, unknown>>;
  repositories: Array<Record<string, unknown>>;
  installUrl: string | null;
}

describe("GET /api/inbox", () => {
  const harness = registerSharedPglite();
  let app: ApiApp;
  let kp: KeyProvider;
  let fake: FakeGitHub;
  let capture: TestLogging;

  beforeEach(() => {
    kp = createKeyProvider();
    fake = makeFakeGitHub();
    capture = testLogging();
    stubNoNetwork();
    resetLiveReadMemory();
    app = createApp({
      logger: capture.logger,
      handle: harness.handle,
      webhookSecret: SECRET,
      auth: buildFakeAuthDeps(kp, fake),
      ...UNUSED_INSTALLATION_DEPS,
      githubAppSlug: APP_SLUG,
    });
  });

  async function get(path: string, cookie?: string): Promise<Response> {
    return app.request(
      path,
      cookie === undefined
        ? {}
        : { headers: { Cookie: `__Host-mergebrief_session=${cookie}` } },
    );
  }

  async function readBody(res: Response): Promise<InboxBody> {
    const body: unknown = await res.json();
    if (typeof body !== "object" || body === null) {
      throw new Error("no body");
    }
    return body as InboxBody;
  }

  it("401s a signed-out viewer without calling GitHub", async () => {
    arrangeGitHub(fake);

    const res = await get("/api/inbox");

    expect(res.status).toBe(401);
    expect(fake.calls).toEqual([]);
  });

  it("a row's stack comes from the repository's live open list", async () => {
    arrangeGitHub(fake, {
      openList: [
        { number: 7, head: "feat/one", base: "main" },
        { number: 8, head: "feat/two", base: "feat/one" },
        { number: 9, head: "feat/three", base: "feat/two" },
      ],
    });
    const { cookie } = await seedSignIn(harness.handle, kp);
    await seedPr(harness.handle, { ctx: TENANT, repoId: REPO_A, prNumber: 8 });
    await seedPr(harness.handle, { ctx: TENANT, repoId: REPO_A, prNumber: 3 });

    const body = await readBody(await get("/api/inbox", cookie));

    const byNumber = new Map(
      body.items.map((item) => [item["prNumber"], item["stack"]]),
    );
    expect(byNumber.get(8)).toEqual({ index: 2, size: 3 });
    // An open row the list does not hold has no stack.
    expect(byNumber.get(3)).toBeNull();
  });

  it("a merged row keeps its recorded stack when the open list is refused", async () => {
    arrangeGitHub(fake);
    fake.failOn("listOpenPullRequests", FakeFailures.NOT_FOUND);
    const { cookie } = await seedSignIn(harness.handle, kp);
    const pr = await seedPr(harness.handle, {
      ctx: TENANT,
      repoId: REPO_A,
      prNumber: 8,
    });
    await createTenantRepository(harness.handle, TENANT).pullRequests.upsert({
      repoId: pr.repoId,
      prNumber: pr.prNumber,
      state: PrStates.MERGED,
      closedAt: new Date(),
    });
    await recordStack(harness.handle, TENANT, pr.id, {
      index: 1,
      members: [
        { number: 8, title: "PR 8" },
        { number: 9, title: "PR 9" },
      ],
    });

    const body = await readBody(await get("/api/inbox?state=merged", cookie));

    expect(body.items[0]?.["stack"]).toEqual({ index: 1, size: 2 });
  });

  it("an open row shows no recorded stack when the open list is refused", async () => {
    arrangeGitHub(fake);
    fake.failOn("listOpenPullRequests", FakeFailures.NOT_FOUND);
    const { cookie } = await seedSignIn(harness.handle, kp);
    const pr = await seedPr(harness.handle, {
      ctx: TENANT,
      repoId: REPO_A,
      prNumber: 8,
    });
    await seedBrief(harness.handle, TENANT, pr.id);
    await recordStack(harness.handle, TENANT, pr.id, {
      index: 1,
      members: [
        { number: 8, title: "PR 8" },
        { number: 9, title: "PR 9" },
      ],
    });

    const body = await readBody(await get("/api/inbox", cookie));

    expect(body.items[0]?.["stack"]).toBeNull();
  });

  it("a reopened row the live list holds on its own clears its record", async () => {
    arrangeGitHub(fake, {
      openList: [{ number: 8, head: "feat/one", base: "main" }],
    });
    const { cookie } = await seedSignIn(harness.handle, kp);
    const pr = await seedPr(harness.handle, {
      ctx: TENANT,
      repoId: REPO_A,
      prNumber: 8,
    });
    await createTenantRepository(harness.handle, TENANT).pullRequests.upsert({
      repoId: pr.repoId,
      prNumber: pr.prNumber,
      state: PrStates.MERGED,
      closedAt: new Date(),
    });
    await recordStack(harness.handle, TENANT, pr.id, {
      index: 1,
      members: [
        { number: 8, title: "PR 8" },
        { number: 9, title: "PR 9" },
      ],
    });

    const body = await readBody(await get("/api/inbox?state=merged", cookie));

    expect(body.items[0]?.["stack"]).toBeNull();
  });

  it("lists the reachable installation's rows and the viewer's url rows", async () => {
    arrangeGitHub(fake);
    const { cookie } = await seedSignIn(harness.handle, kp);
    const tenantRow = await seedPr(harness.handle, {
      ctx: TENANT,
      repoId: REPO_A,
      prNumber: 1,
      title: "tenant",
      updatedAt: new Date("2026-09-02T00:00:00Z"),
    });
    await seedBrief(harness.handle, TENANT, tenantRow.id);
    await seedPr(harness.handle, {
      ctx: OWNER,
      repoId: REPO_URL,
      prNumber: 7,
      title: "pasted",
      authorLogin: "octocat",
      fresh: true,
    });
    await seedPr(harness.handle, {
      ctx: OTHER_TENANT,
      repoId: REPO_A,
      prNumber: 9,
      title: "unreachable installation",
    });

    const lookups = spyPullRequestLookups(harness);

    const res = await get("/api/inbox", cookie);

    expect(res.status).toBe(200);
    expect(lookups.count()).toBe(0);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await readBody(res);
    expect(body.items.map((item) => item["title"])).toEqual([
      "tenant",
      "pasted",
    ]);
    expect(body.items[0]).toMatchObject({
      repoId: String(REPO_A),
      installationId: String(INSTALLATION_ID),
      source: "installation",
      reviewState: "new",
      authorLogin: "someone",
      viewerIsAuthor: false,
      viewerCanDelete: false,
      behind: false,
      unreachable: false,
      generation: null,
      latestBriefAt: expect.any(String),
      githubUpdatedAt: "2026-09-02T00:00:00.000Z",
      stack: null,
    });
    expect(body.items[1]).toMatchObject({
      installationId: null,
      source: "url",
      reviewState: null,
      authorLogin: "octocat",
      viewerIsAuthor: true,
      viewerCanDelete: true,
      latestBriefAt: null,
      stack: null,
    });
    expect(body).toMatchObject({
      page: 1,
      pageSize: INBOX_PAGE_SIZE,
      total: 2,
      counts: { new: 1, inProgress: 0, reviewed: 0, updated: 0 },
      viewer: {
        login: "octocat",
        avatarUrl: `https://avatars.githubusercontent.com/u/${REVIEWER}`,
      },
      reachableInstallations: [
        {
          installationId: String(INSTALLATION_ID),
          accountLogin: `org-${INSTALLATION_ID}`,
        },
      ],
      installUrl: `https://github.com/apps/${APP_SLUG}/installations/new`,
    });
    expect(
      body.repositories.toSorted((first, second) =>
        String(first["repoId"]).localeCompare(String(second["repoId"])),
      ),
    ).toEqual([
      { repoId: String(REPO_A), repoSlug: "o/r" },
      { repoId: String(REPO_URL), repoSlug: expect.any(String) },
    ]);
  });

  it("an installation row the viewer administers on GitHub can be deleted", async () => {
    arrangeGitHub(fake, { adminRepoIds: [REPO_A] });
    const { cookie } = await seedSignIn(harness.handle, kp);
    await seedPr(harness.handle, { ctx: TENANT, repoId: REPO_A, prNumber: 1 });

    const res = await get("/api/inbox", cookie);

    expect(res.status).toBe(200);
    const body = await readBody(res);
    expect(body.items[0]).toMatchObject({
      source: "installation",
      viewerCanDelete: true,
    });
  });

  it("an app composed without a slug serves no install link", async () => {
    arrangeGitHub(fake);
    const { cookie } = await seedSignIn(harness.handle, kp);
    const slugless = createApp({
      logger: testLogger(),
      handle: harness.handle,
      webhookSecret: SECRET,
      auth: buildFakeAuthDeps(kp, fake),
      ...UNUSED_INSTALLATION_DEPS,
    });

    const res = await slugless.request("/api/inbox", {
      headers: { Cookie: `__Host-mergebrief_session=${cookie}` },
    });

    expect(res.status).toBe(200);
    expect((await readBody(res)).installUrl).toBeNull();
  });

  it("a page past the end carries no items and the true total", async () => {
    arrangeGitHub(fake);
    const { cookie } = await seedSignIn(harness.handle, kp);
    await seedPr(harness.handle, { ctx: TENANT, repoId: REPO_A, prNumber: 1 });

    const res = await get("/api/inbox?page=4", cookie);

    expect(res.status).toBe(200);
    expect(await readBody(res)).toMatchObject({
      items: [],
      page: 4,
      total: 1,
    });
  });

  it("filters read repeated keys and refuse a value outside the vocabulary", async () => {
    arrangeGitHub(fake);
    const { cookie } = await seedSignIn(harness.handle, kp);
    await seedPr(harness.handle, {
      ctx: TENANT,
      repoId: REPO_A,
      prNumber: 1,
      authorLogin: "octocat",
    });
    await seedPr(harness.handle, { ctx: TENANT, repoId: REPO_A, prNumber: 2 });

    const mine = await get(
      "/api/inbox?author=mine&state=open&state=draft",
      cookie,
    );
    const bad = await get("/api/inbox?sort=alphabetical", cookie);
    const badLayout = await get("/api/inbox?layout=sideways", cookie);
    const mixed = await get("/api/inbox?layout=mixed", cookie);
    const badPage = await get("/api/inbox?page=0", cookie);
    const badRepo = await get("/api/inbox?repo=abc", cookie);
    const badInstallation = await get("/api/inbox?installation=1e3", cookie);

    expect((await readBody(mine)).items.map((i) => i["prNumber"])).toEqual([1]);
    expect(bad.status).toBe(400);
    expect(badLayout.status).toBe(400);
    expect(mixed.status).toBe(200);
    expect(badPage.status).toBe(400);
    expect(badRepo.status).toBe(400);
    expect(badInstallation.status).toBe(400);
  });

  it("search text narrows the list by title and by number", async () => {
    arrangeGitHub(fake);
    const { cookie } = await seedSignIn(harness.handle, kp);
    const anchors = {
      ctx: TENANT,
      repoId: REPO_A,
      title: "Sanitize anchor ids",
    };
    await seedPr(harness.handle, { ...anchors, prNumber: 1412 });
    await seedPr(harness.handle, { ctx: TENANT, repoId: REPO_A, prNumber: 2 });

    const byWord = await readBody(await get("/api/inbox?q=ANCHOR", cookie));
    const byNumber = await readBody(await get("/api/inbox?q=%23141", cookie));
    const padded = await readBody(
      await get("/api/inbox?q=%20anchor%20", cookie),
    );

    expect(byWord.items.map((item) => item["prNumber"])).toEqual([1412]);
    expect(byWord.searchMatchTotal).toBe(1);
    expect(byNumber.items.map((item) => item["prNumber"])).toEqual([1412]);
    expect(padded.items.map((item) => item["prNumber"])).toEqual([1412]);
  });

  it("empty search text narrows nothing and counts no match", async () => {
    arrangeGitHub(fake);
    const { cookie } = await seedSignIn(harness.handle, kp);
    await seedPr(harness.handle, { ctx: TENANT, repoId: REPO_A, prNumber: 1 });

    const blank = await readBody(await get("/api/inbox?q=%20%20", cookie));
    const absent = await readBody(await get("/api/inbox", cookie));

    expect(blank.total).toBe(1);
    expect(blank.searchMatchTotal).toBe(0);
    expect(absent.searchMatchTotal).toBe(0);
  });

  it("search text past the bound is cut, never refused", async () => {
    arrangeGitHub(fake);
    const { cookie } = await seedSignIn(harness.handle, kp);
    const longTitle = "a".repeat(InboxQueryBounds.MAX_SEARCH_TEXT_LENGTH);
    const row = { ctx: TENANT, repoId: REPO_A, prNumber: 1, title: longTitle };
    await seedPr(harness.handle, row);

    const res = await get(`/api/inbox?q=${longTitle}zzz`, cookie);

    expect(res.status).toBe(200);
    expect((await readBody(res)).total).toBe(1);
  });

  it("a NUL character in the search text is dropped, never a 500", async () => {
    arrangeGitHub(fake);
    const { cookie } = await seedSignIn(harness.handle, kp);
    const row = { ctx: TENANT, repoId: REPO_A, prNumber: 1 };
    await seedPr(harness.handle, { ...row, title: "Sanitize anchor ids" });

    const res = await get("/api/inbox?q=an%00chor", cookie);

    expect(res.status).toBe(200);
    expect((await readBody(res)).total).toBe(1);
  });

  it("the cut never splits a character in two", async () => {
    arrangeGitHub(fake);
    const { cookie } = await seedSignIn(harness.handle, kp);
    const filler = "a".repeat(InboxQueryBounds.MAX_SEARCH_TEXT_LENGTH - 1);
    const row = { ctx: TENANT, repoId: REPO_A, prNumber: 1 };
    await seedPr(harness.handle, { ...row, title: `${filler}\u{1F680}` });

    const query = encodeURIComponent(`${filler}\u{1F680}zzz`);
    const body = await readBody(await get(`/api/inbox?q=${query}`, cookie));

    expect(body.total).toBe(1);
  });

  it("search text counts the matches the status filter hides", async () => {
    arrangeGitHub(fake);
    const { cookie } = await seedSignIn(harness.handle, kp);
    const merged = await seedPr(harness.handle, {
      ctx: TENANT,
      repoId: REPO_A,
      prNumber: 1412,
      title: "Sanitize anchor ids",
    });
    await createTenantRepository(harness.handle, TENANT).pullRequests.upsert({
      repoId: merged.repoId,
      prNumber: merged.prNumber,
      state: PrStates.MERGED,
      closedAt: new Date(),
    });

    const body = await readBody(await get("/api/inbox?q=anchor", cookie));

    expect(body.total).toBe(0);
    expect(body.searchMatchTotal).toBe(1);
    expect(body.archivedSearchMatchTotal).toBe(0);
  });

  it("no state key on the wire reads as open and draft", async () => {
    arrangeGitHub(fake);
    const { cookie } = await seedSignIn(harness.handle, kp);
    await seedPr(harness.handle, { ctx: TENANT, repoId: REPO_A, prNumber: 1 });
    const merged = await seedPr(harness.handle, {
      ctx: TENANT,
      repoId: REPO_A,
      prNumber: 2,
    });
    await createTenantRepository(harness.handle, TENANT).pullRequests.upsert({
      repoId: merged.repoId,
      prNumber: merged.prNumber,
      state: PrStates.MERGED,
      closedAt: new Date(),
    });

    const opening = await get("/api/inbox", cookie);
    const every = await get(
      "/api/inbox?state=open&state=draft&state=merged&state=closed",
      cookie,
    );

    expect((await readBody(opening)).items.map((i) => i["prNumber"])).toEqual([
      1,
    ]);
    expect((await readBody(every)).items).toHaveLength(2);
  });

  it("a repository the viewer cannot read stays off the list", async () => {
    arrangeGitHub(fake);
    const { cookie } = await seedSignIn(harness.handle, kp);
    await seedPr(harness.handle, { ctx: TENANT, repoId: REPO_A, prNumber: 1 });
    await seedPr(harness.handle, {
      ctx: TENANT,
      repoId: REPO_PRIVATE,
      prNumber: 2,
      title: "private",
    });

    const res = await get("/api/inbox", cookie);

    expect(res.status).toBe(200);
    const body = await readBody(res);
    expect(body.items.map((item) => item["prNumber"])).toEqual([1]);
    expect(body.counts["new"]).toBe(1);
  });

  it("a caller's installation or repo filter cannot widen the reach", async () => {
    arrangeGitHub(fake);
    const { cookie } = await seedSignIn(harness.handle, kp);
    await seedPr(harness.handle, { ctx: TENANT, repoId: REPO_A, prNumber: 1 });
    await seedPr(harness.handle, {
      ctx: OTHER_TENANT,
      repoId: REPO_A,
      prNumber: 9,
    });
    await seedPr(harness.handle, {
      ctx: OWNER,
      repoId: REPO_URL,
      prNumber: 7,
      fresh: true,
    });

    const res = await get(
      `/api/inbox?installation=${String(OTHER_INSTALLATION_ID)}&repo=${String(REPO_A)}`,
      cookie,
    );

    expect(res.status).toBe(200);
    expect((await readBody(res)).items).toEqual([]);
  });

  it("a dead token on the installations check is a 401", async () => {
    arrangeGitHub(fake);
    fake.failOn("listUserInstallations", FakeFailures.UNAUTHORIZED);
    stubRefusedTokenRefresh();
    const { cookie } = await seedSignIn(harness.handle, kp);

    const res = await get("/api/inbox", cookie);

    expect(res.status).toBe(401);
  });

  async function countSessions(cookieHash: string): Promise<number> {
    const sessions = await harness.raw(
      "select id from auth_session where session_token_hash = $1",
      [cookieHash],
    );
    return sessions.length;
  }

  it("a token that will not decrypt is a 500 and keeps the session", async () => {
    arrangeGitHub(fake);
    const { cookie, cookieHash } = await seedSignIn(harness.handle, kp);
    await harness.raw("update github_grant set gh_token_ciphertext = 'sealed'");

    const res = await get("/api/inbox", cookie);

    expect(res.status).toBe(500);
    expect(fake.calls).toEqual([]);
    expect(await countSessions(cookieHash)).toBe(1);
    const line = capture
      .lines()
      .find((entry) => entry["evt"] === "token.decrypt.fail");
    expect(line?.["level"]).toBe("error");
  });

  it.each([
    [
      "a wrong client secret",
      makeOAuthErrorBody("incorrect_client_credentials"),
      "incorrect_client_credentials",
    ],
    [
      "another client-config error",
      makeOAuthErrorBody("unsupported_grant_type"),
      "unsupported_grant_type",
    ],
    [
      "tokens that do not expire",
      { access_token: "ghu_NON_EXPIRING", token_type: "bearer", scope: "" },
      "expiration-not-enabled",
    ],
  ])("keeps the session and answers 500 on %s", async (_, answer, kind) => {
    arrangeGitHub(fake);
    fake.failOn("listUserInstallations", FakeFailures.UNAUTHORIZED);
    stubTokenRefreshAnswer(answer);
    const { cookie, cookieHash } = await seedSignIn(harness.handle, kp);

    const res = await get("/api/inbox", cookie);

    expect(res.status).toBe(500);
    expect(await countSessions(cookieHash)).toBe(1);
    const line = capture
      .lines()
      .find((entry) => entry["evt"] === "token.refresh.fail");
    expect(line?.["level"]).toBe("error");
    expect(line?.["kind"]).toBe(kind);
  });

  it("a dead token on the repositories walk is a 401", async () => {
    arrangeGitHub(fake);
    fake.failOn("listInstallationRepositories", FakeFailures.UNAUTHORIZED);
    stubRefusedTokenRefresh();
    const { cookie } = await seedSignIn(harness.handle, kp);

    const res = await get("/api/inbox", cookie);

    expect(res.status).toBe(401);
  });

  it("a GitHub failure on the repositories walk fails the list", async () => {
    arrangeGitHub(fake);
    fake.failOn("listInstallationRepositories", FakeFailures.SERVER_ERROR);
    const { cookie } = await seedSignIn(harness.handle, kp);
    await seedPr(harness.handle, { ctx: TENANT, repoId: REPO_A, prNumber: 1 });

    const res = await get("/api/inbox", cookie);

    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ code: "github-unavailable" });
  });

  it("a denied repositories walk leaves that installation out, not the list", async () => {
    arrangeGitHub(fake);
    fake.failOn("listInstallationRepositories", FakeFailures.FORBIDDEN);
    const { cookie } = await seedSignIn(harness.handle, kp);
    await seedPr(harness.handle, { ctx: TENANT, repoId: REPO_A, prNumber: 1 });

    const res = await get("/api/inbox", cookie);

    expect(res.status).toBe(200);
    expect((await readBody(res)).items).toEqual([]);
  });

  it("an oversized id or page is a 400, never a database error", async () => {
    arrangeGitHub(fake);
    const { cookie } = await seedSignIn(harness.handle, kp);

    const repo = await get("/api/inbox?repo=9999999999999999999", cookie);
    const page = await get("/api/inbox?page=1e21", cookie);
    const gone = await app.request("/api/inbox/99999999999999999999/7", {
      method: "DELETE",
      headers: {
        ...SAME_ORIGIN_HEADERS,
        Cookie: `__Host-mergebrief_session=${cookie}`,
      },
    });

    expect(repo.status).toBe(400);
    expect(page.status).toBe(400);
    expect(gone.status).toBe(404);
  });

  it("a GitHub failure on the installations check fails the list", async () => {
    arrangeGitHub(fake);
    fake.failOn("listUserInstallations", FakeFailures.FORBIDDEN);
    const { cookie } = await seedSignIn(harness.handle, kp);
    await seedPr(harness.handle, { ctx: TENANT, repoId: REPO_A, prNumber: 1 });

    const res = await get("/api/inbox", cookie);

    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ code: "github-unavailable" });
  });

  function buildAppWithOperatorToken(ownerId: number): ApiApp {
    return createApp({
      logger: testLogger(),
      handle: harness.handle,
      webhookSecret: SECRET,
      auth: buildFakeAuthDeps(kp, fake),
      ...UNUSED_INSTALLATION_DEPS,
      operatorToken: buildOperatorToken(OPERATOR_PAT, ownerId),
    });
  }

  it("retries the owner's live read on the operator token", async () => {
    arrangeGitHub(fake);
    arrangeLiveUrlPull(fake);
    hideLiveReadFromViewer(fake);
    const { cookie } = await seedSignIn(harness.handle, kp);
    await seedPr(harness.handle, { ctx: OWNER, repoId: REPO_URL, prNumber: 7 });
    app = buildAppWithOperatorToken(Number(REVIEWER));

    const res = await get("/api/inbox", cookie);

    expect(res.status).toBe(200);
    expect(listFakeCallTokens(fake)).toContain(OPERATOR_PAT);
    expect((await readBody(res)).items[0]).toMatchObject({
      title: "Live title",
    });
  });

  it("reads the open lists on the viewer's token alone", async () => {
    arrangeGitHub(fake, {
      openList: [{ number: 8, head: "feat/one", base: "main" }],
    });
    fake.failOn(
      "listOpenPullRequests",
      FakeFailures.NOT_FOUND,
      CredentialKinds.REVIEWER,
    );
    const { cookie } = await seedSignIn(harness.handle, kp);
    await seedPr(harness.handle, { ctx: TENANT, repoId: REPO_A, prNumber: 8 });
    app = buildAppWithOperatorToken(Number(REVIEWER));

    const res = await get("/api/inbox", cookie);

    expect(res.status).toBe(200);
    expect((await readBody(res)).items[0]?.["stack"]).toBeNull();
    const listings = fake.listCalls("listOpenPullRequests");
    expect(listings.map((call) => call.credential.kind)).toEqual([
      CredentialKinds.REVIEWER,
    ]);
  });

  it("sends no operator token for a viewer who does not own it", async () => {
    arrangeGitHub(fake);
    arrangeLiveUrlPull(fake);
    hideLiveReadFromViewer(fake);
    const { cookie } = await seedSignIn(harness.handle, kp);
    await seedPr(harness.handle, { ctx: OWNER, repoId: REPO_URL, prNumber: 7 });
    app = buildAppWithOperatorToken(Number(REVIEWER) + 1);

    const res = await get("/api/inbox", cookie);

    expect(res.status).toBe(200);
    expect(listFakeCallTokens(fake)).not.toContain(OPERATOR_PAT);
    expect((await readBody(res)).items[0]).toMatchObject({ title: "PR 7" });
  });

  it("reads an installation row live, past a webhook that never came", async () => {
    arrangeGitHub(fake, {
      openList: [{ number: 3, head: "feature", base: "main" }],
    });
    const { cookie } = await seedSignIn(harness.handle, kp);
    await seedPr(harness.handle, {
      ctx: TENANT,
      repoId: REPO_A,
      prNumber: 3,
      draft: true,
      updatedAt: new Date("2025-12-01T00:00:00Z"),
    });

    const res = await get("/api/inbox", cookie);

    expect(res.status).toBe(200);
    expect(countLiveReads(fake)).toBe(1);
    const body = await readBody(res);
    expect(body.items[0]).toMatchObject({ prNumber: 3, draft: false });
  });

  it("reads a stale url row live before listing it", async () => {
    arrangeGitHub(fake);
    arrangeLiveUrlPull(fake);
    const { cookie } = await seedSignIn(harness.handle, kp);
    await seedPr(harness.handle, {
      ctx: OWNER,
      repoId: REPO_URL,
      prNumber: 7,
      title: "stale title",
    });

    const res = await get("/api/inbox", cookie);

    expect(res.status).toBe(200);
    expect(countLiveReads(fake)).toBe(1);
    const body = await readBody(res);
    expect(body.items[0]).toMatchObject({
      title: "Live title",
      githubUpdatedAt: "2026-09-20T10:00:00.000Z",
    });
  });
});
