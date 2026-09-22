// GET /api/inbox over PGlite with GitHub stubbed: the envelope across an
// installation and the viewer's own url rows, the defaults, a page past the
// end, the signed-out and upstream-failure postures, and the live read
// before the list.
import { createHash, randomBytes } from "node:crypto";
import {
  createArtifactStore,
  createGrantAuth,
  createTenantRepository,
  encryptToken,
  isInstallationId,
  isRepoId,
  isReviewerId,
  PrStates,
  type AppDatabase,
  type KeyProvider,
  type PullRequestUpsertInput,
  type ReviewerId,
  type ScopeContext,
} from "persistence";
import { createPgliteHarness, type PgliteHarness } from "persistence/testing";
import type { Mutable } from "types/utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, type ApiApp } from "../src/index";
import { INBOX_PAGE_SIZE } from "../src/routes/wire-bounds";
import { resetLiveReadMemory } from "../src/routes/live-read";
import { testLogger } from "./logging";
import {
  INSTALLATION_ID,
  KEY_REF,
  SECRET,
  answerUserInstallations,
  buildAuthDeps,
  createKeyProvider,
  getRequestUrl,
} from "./fixtures";

const ACCESS_TOKEN = "ghu_ACCESS_TOKEN_PLAINTEXT";
const REFRESH_TOKEN = "ghr_REFRESH_TOKEN_PLAINTEXT";
const OTHER_INSTALLATION_ID = 111222;
const REPO_A = 424242;
const REPO_URL = 535353;
const REPO_PRIVATE = 646464;
const HEAD = "a".repeat(40);
const APP_SLUG = "mergebrief-test";

function brand<T extends bigint>(
  guard: (v: bigint) => v is T,
  value: number,
): T {
  const asBigInt = BigInt(value);
  if (!guard(asBigInt)) throw new Error("bad branded id");
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

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      date: new Date().toUTCString(),
    },
  });
}

interface StubCounts {
  installations: number;
  graphql: number;
}

interface OpenListEntry {
  readonly number: number;
  readonly head: string;
  readonly base: string;
}

function answerOpenList(entries: readonly OpenListEntry[]): Response {
  const repo = { name: "r", owner: { login: "o" } };
  return jsonResponse(
    entries.map((entry) => ({
      number: entry.number,
      title: `PR ${entry.number}`,
      head: { ref: entry.head, repo },
      base: { ref: entry.base, repo },
    })),
  );
}

/**
 * `GET /user/installations` answers the reachable set; GraphQL the live
 * read; the repo's open list the stacks, empty unless a test hands one.
 */
function stubGitHub(
  installationsStatus = 200,
  repositoriesStatus = 200,
  openList: readonly OpenListEntry[] | number = [],
): StubCounts {
  const counts: StubCounts = { installations: 0, graphql: 0 };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request): Promise<Response> => {
      const url = getRequestUrl(input);
      if (url.endsWith("/user/installations?per_page=100")) {
        counts.installations += 1;
        if (installationsStatus !== 200) {
          return jsonResponse({ message: "down" }, installationsStatus);
        }
        return answerUserInstallations([INSTALLATION_ID]);
      }
      if (
        url.includes("/user/installations/") &&
        url.includes("/repositories")
      ) {
        if (repositoriesStatus !== 200) {
          return jsonResponse({ message: "down" }, repositoriesStatus);
        }
        return jsonResponse({
          total_count: 1,
          repositories: [{ id: REPO_A, full_name: "o/r" }],
        });
      }
      if (/\/repos\/[^/]+\/[^/]+\/pulls\?/.test(url)) {
        if (typeof openList === "number") {
          return jsonResponse({ message: "down" }, openList);
        }
        return answerOpenList(openList);
      }
      if (url.endsWith("/graphql")) {
        counts.graphql += 1;
        return jsonResponse({
          data: {
            p0: {
              databaseId: REPO_URL,
              nameWithOwner: "o/url",
              pullRequest: {
                state: "OPEN",
                isDraft: false,
                title: "Live title",
                closedAt: null,
                updatedAt: "2026-09-20T10:00:00Z",
                headRefOid: HEAD,
              },
            },
          },
        });
      }
      throw new Error(`unexpected fetch in inbox suite: ${url}`);
    }),
  );
  return counts;
}

async function seedSession(
  handle: AppDatabase,
  kp: KeyProvider,
): Promise<string> {
  const cookie = randomBytes(32).toString("base64url");
  const hash = createHash("sha256").update(cookie).digest("hex");
  const sealedAccess = await encryptToken(kp, KEY_REF, ACCESS_TOKEN);
  const sealedRefresh = await encryptToken(kp, KEY_REF, REFRESH_TOKEN);
  if (!sealedAccess.ok || !sealedRefresh.ok) {
    throw new Error("seed encrypt failed");
  }
  const grant = await createGrantAuth(handle).createGrant({
    ghTokenCiphertext: sealedAccess.value,
    ghRefreshTokenCiphertext: sealedRefresh.value,
    keyRef: KEY_REF,
    refreshExpiresAt: new Date("2027-01-01T00:00:00Z"),
  });
  await createTenantRepository(handle, OWNER).sessions.create({
    sessionTokenHash: hash,
    reviewerId: REVIEWER,
    reviewerLogin: "octocat",
    grantId: grant.id,
    expiresAt: new Date("2027-01-01T00:00:00Z"),
  });
  return cookie;
}

interface SeedInput {
  readonly ctx: ScopeContext;
  readonly repoId: number;
  readonly prNumber: number;
  readonly title?: string;
  readonly authorLogin?: string;
  readonly updatedAt?: Date;
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
  const written = await createArtifactStore(handle, ctx).briefs.write({
    pullRequestId,
    baseSha: "b".repeat(40),
    headSha: HEAD,
    headIndex: 1,
    commitCount: 1,
    provider: "p",
    model: "m",
    effort: "e",
    body,
  });
  if (!written.ok) throw new Error("brief seed failed");
}

const unusedConversationPort = {
  fetchPullRequestConversation: async () => {
    throw new Error("conversation port must not be called in this suite");
  },
  listRepoCollaborators: async () => {
    throw new Error("collaborators port must not be called in this suite");
  },
};

interface InboxBody {
  items: Array<Record<string, unknown>>;
  page: number;
  pageSize: number;
  total: number;
  counts: Record<string, number>;
  viewer: Record<string, unknown>;
  reachableInstallations: Array<Record<string, unknown>>;
  repositories: Array<Record<string, unknown>>;
  installUrl: string | null;
}

describe("GET /api/inbox", () => {
  let harness: PgliteHarness;
  let app: ApiApp;
  let kp: KeyProvider;

  beforeEach(async () => {
    harness = await createPgliteHarness();
    kp = createKeyProvider();
    resetLiveReadMemory();
    app = createApp({
      logger: testLogger(),
      handle: harness.handle,
      webhookSecret: SECRET,
      auth: buildAuthDeps(kp),
      github: unusedConversationPort,
      githubAppSlug: APP_SLUG,
    });
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await harness.close();
  });

  async function get(path: string, cookie?: string): Promise<Response> {
    return app.request(
      path,
      cookie === undefined
        ? {}
        : { headers: { Cookie: `rs_session=${cookie}` } },
    );
  }

  async function readBody(res: Response): Promise<InboxBody> {
    const body: unknown = await res.json();
    if (typeof body !== "object" || body === null) throw new Error("no body");
    return body as InboxBody;
  }

  it("401s a signed-out viewer without calling GitHub", async () => {
    const counts = stubGitHub();

    const res = await get("/api/inbox");

    expect(res.status).toBe(401);
    expect(counts.installations).toBe(0);
  });

  it("a row's stack comes from the repository's live open list", async () => {
    stubGitHub(200, 200, [
      { number: 7, head: "feat/one", base: "main" },
      { number: 8, head: "feat/two", base: "feat/one" },
      { number: 9, head: "feat/three", base: "feat/two" },
    ]);
    const cookie = await seedSession(harness.handle, kp);
    await seedPr(harness.handle, { ctx: TENANT, repoId: REPO_A, prNumber: 8 });
    await seedPr(harness.handle, { ctx: TENANT, repoId: REPO_A, prNumber: 3 });

    const body = await readBody(await get("/api/inbox", cookie));

    const byNumber = new Map(
      body.items.map((item) => [item["prNumber"], item["stack"]]),
    );
    expect(byNumber.get(8)).toEqual({ index: 2, size: 3 });
    // A row the open list does not hold keeps its stored snapshot: none.
    expect(byNumber.get(3)).toBeNull();
  });

  it("a refused open list keeps the stored stack snapshot", async () => {
    stubGitHub(200, 200, 404);
    const cookie = await seedSession(harness.handle, kp);
    const pr = await seedPr(harness.handle, {
      ctx: TENANT,
      repoId: REPO_A,
      prNumber: 8,
    });
    await seedBrief(
      harness.handle,
      TENANT,
      pr.id,
      JSON.stringify({
        stack: {
          index: 1,
          members: [
            { number: 8, title: "PR 8" },
            { number: 9, title: "PR 9" },
          ],
        },
      }),
    );

    const body = await readBody(await get("/api/inbox", cookie));

    expect(body.items[0]?.["stack"]).toEqual({ index: 1, size: 2 });
  });

  it("a row the live list holds on its own clears its stored snapshot", async () => {
    stubGitHub(200, 200, [{ number: 8, head: "feat/one", base: "main" }]);
    const cookie = await seedSession(harness.handle, kp);
    const pr = await seedPr(harness.handle, {
      ctx: TENANT,
      repoId: REPO_A,
      prNumber: 8,
    });
    await seedBrief(
      harness.handle,
      TENANT,
      pr.id,
      JSON.stringify({
        stack: {
          index: 1,
          members: [
            { number: 8, title: "PR 8" },
            { number: 9, title: "PR 9" },
          ],
        },
      }),
    );

    const body = await readBody(await get("/api/inbox", cookie));

    expect(body.items[0]?.["stack"]).toBeNull();
  });

  it("lists the reachable installation's rows and the viewer's url rows", async () => {
    stubGitHub();
    const cookie = await seedSession(harness.handle, kp);
    const tenantRow = await seedPr(harness.handle, {
      ctx: TENANT,
      repoId: REPO_A,
      prNumber: 1,
      title: "tenant",
      updatedAt: new Date("2026-09-02T00:00:00Z"),
    });
    await seedBrief(
      harness.handle,
      TENANT,
      tenantRow.id,
      JSON.stringify({
        stack: {
          members: [
            { number: 1, title: "one" },
            { number: 2, title: "two" },
          ],
          index: 2,
        },
      }),
    );
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

    const res = await get("/api/inbox", cookie);

    expect(res.status).toBe(200);
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
      viewerIsAuthor: false,
      behind: false,
      unreachable: false,
      generation: null,
      latestBriefAt: expect.any(String),
      githubUpdatedAt: "2026-09-02T00:00:00.000Z",
      stack: { index: 2, size: 2 },
    });
    expect(body.items[1]).toMatchObject({
      installationId: null,
      source: "url",
      reviewState: null,
      viewerIsAuthor: true,
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

  it("an app composed without a slug serves no install link", async () => {
    stubGitHub();
    const cookie = await seedSession(harness.handle, kp);
    const slugless = createApp({
      logger: testLogger(),
      handle: harness.handle,
      webhookSecret: SECRET,
      auth: buildAuthDeps(kp),
      github: unusedConversationPort,
    });

    const res = await slugless.request("/api/inbox", {
      headers: { Cookie: `rs_session=${cookie}` },
    });

    expect(res.status).toBe(200);
    expect((await readBody(res)).installUrl).toBeNull();
  });

  it("a page past the end carries no items and the true total", async () => {
    stubGitHub();
    const cookie = await seedSession(harness.handle, kp);
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
    stubGitHub();
    const cookie = await seedSession(harness.handle, kp);
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
    const badPage = await get("/api/inbox?page=0", cookie);

    expect((await readBody(mine)).items.map((i) => i["prNumber"])).toEqual([1]);
    expect(bad.status).toBe(400);
    expect(badPage.status).toBe(400);
  });

  it("no state key on the wire reads as open and draft", async () => {
    stubGitHub();
    const cookie = await seedSession(harness.handle, kp);
    await seedPr(harness.handle, { ctx: TENANT, repoId: REPO_A, prNumber: 1 });
    const merged = await seedPr(harness.handle, {
      ctx: TENANT,
      repoId: REPO_A,
      prNumber: 2,
    });
    await createTenantRepository(harness.handle, TENANT).pullRequests.setState(
      merged.id,
      { state: PrStates.MERGED, closedAt: new Date(), purgeAfter: null },
    );

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
    stubGitHub();
    const cookie = await seedSession(harness.handle, kp);
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
    stubGitHub();
    const cookie = await seedSession(harness.handle, kp);
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
    stubGitHub(401);
    const cookie = await seedSession(harness.handle, kp);

    const res = await get("/api/inbox", cookie);

    expect(res.status).toBe(401);
  });

  it("a dead token on the repositories walk is a 401", async () => {
    stubGitHub(200, 401);
    const cookie = await seedSession(harness.handle, kp);

    const res = await get("/api/inbox", cookie);

    expect(res.status).toBe(401);
  });

  it("a GitHub failure on the repositories walk fails the list", async () => {
    stubGitHub(200, 422);
    const cookie = await seedSession(harness.handle, kp);
    await seedPr(harness.handle, { ctx: TENANT, repoId: REPO_A, prNumber: 1 });

    const res = await get("/api/inbox", cookie);

    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ code: "github-unavailable" });
  });

  it("a denied repositories walk leaves that installation out, not the list", async () => {
    stubGitHub(200, 403);
    const cookie = await seedSession(harness.handle, kp);
    await seedPr(harness.handle, { ctx: TENANT, repoId: REPO_A, prNumber: 1 });

    const res = await get("/api/inbox", cookie);

    expect(res.status).toBe(200);
    expect((await readBody(res)).items).toEqual([]);
  });

  it("an oversized id or page is a 400, never a database error", async () => {
    stubGitHub();
    const cookie = await seedSession(harness.handle, kp);

    const repo = await get("/api/inbox?repo=9999999999999999999", cookie);
    const page = await get("/api/inbox?page=1e21", cookie);
    const gone = await app.request("/api/inbox/99999999999999999999/7", {
      method: "DELETE",
      headers: { Cookie: `rs_session=${cookie}` },
    });

    expect(repo.status).toBe(400);
    expect(page.status).toBe(400);
    expect(gone.status).toBe(404);
  });

  it("a GitHub failure on the installations check fails the list", async () => {
    stubGitHub(403);
    const cookie = await seedSession(harness.handle, kp);
    await seedPr(harness.handle, { ctx: TENANT, repoId: REPO_A, prNumber: 1 });

    const res = await get("/api/inbox", cookie);

    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ code: "github-unavailable" });
  });

  it("reads a stale url row live before listing it", async () => {
    const counts = stubGitHub();
    const cookie = await seedSession(harness.handle, kp);
    await seedPr(harness.handle, {
      ctx: OWNER,
      repoId: REPO_URL,
      prNumber: 7,
      title: "stale title",
    });

    const res = await get("/api/inbox", cookie);

    expect(res.status).toBe(200);
    expect(counts.graphql).toBe(1);
    const body = await readBody(res);
    expect(body.items[0]).toMatchObject({
      title: "Live title",
      githubUpdatedAt: "2026-09-20T10:00:00.000Z",
    });
  });
});
