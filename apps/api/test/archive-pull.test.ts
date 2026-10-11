// PUT and DELETE /api/repos/:repoId/pulls/:prNumber/archive: the viewer's
// own archive of one inbox row, behind the per-PR gate, per reviewer. Full
// wire over PGlite. The archive makes no GitHub call, so the reviewer
// binding's fake must see none; the gate and the inbox list still fetch.
import { makeFakeGitHub, type FakeGitHub } from "github/testing";
import {
  createInboxStore,
  createTenantRepository,
  WriteClassifications,
  type AppDatabase,
  type KeyProvider,
  type ScopeContext,
} from "persistence";
import { PrStates } from "types/pull-requests";
import {
  InboxArchivedFilters,
  InboxAuthorFilters,
  InboxLayouts,
  InboxSorts,
} from "types/inbox";
import { createPgliteHarness, type PgliteHarness } from "persistence/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, type ApiApp } from "../src/index";
import { testLogger } from "./logging";
import {
  INSTALLATION_ID,
  PR_NUMBER,
  REPO_SLUG,
  REVIEWER_ID,
  SECRET,
  brandInstallationId,
  brandRepoId,
  brandReviewerId,
  createKeyProvider,
  getRequestUrl,
  answerUserInstallations,
  SAME_ORIGIN_HEADERS,
} from "./fixtures";
import { spyPullRequestLookups } from "./pull-request-lookups";
import { UNUSED_INSTALLATION_DEPS, buildFakeAuthDeps } from "./reviewer-github";
import { seedApiToken } from "./session/fixtures";
import { seedSignIn } from "./sign-in";

vi.setConfig({ testTimeout: 10_000 });

const REPO_ID = 424242;

const TENANT: ScopeContext = {
  installationId: brandInstallationId(BigInt(INSTALLATION_ID)),
};
const OWNER: ScopeContext = {
  ownerUserId: brandReviewerId(BigInt(REVIEWER_ID)),
};
const OTHER_REVIEWER_ID = 999;
const OTHER_OWNER: ScopeContext = {
  ownerUserId: brandReviewerId(BigInt(OTHER_REVIEWER_ID)),
};

const ARCHIVE_PATH = `/api/repos/${REPO_ID}/pulls/${PR_NUMBER}/archive`;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      date: new Date().toUTCString(),
    },
  });
}

/** The gate's reads plus the inbox's live reads; the repo sits in the installation or in none. */
function stubGitHub(inInstallation: boolean): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request): Promise<Response> => {
      const url = getRequestUrl(input);
      if (url.endsWith("/user/installations?per_page=100")) {
        return answerUserInstallations([INSTALLATION_ID]);
      }
      if (
        url.includes("/user/installations/") &&
        url.includes("/repositories")
      ) {
        const repositories = inInstallation
          ? [{ id: REPO_ID, full_name: REPO_SLUG }]
          : [];
        return jsonResponse({
          total_count: repositories.length,
          repositories,
        });
      }
      if (url.includes("/repositories/")) {
        return jsonResponse({
          id: REPO_ID,
          full_name: REPO_SLUG,
          private: true,
        });
      }
      if (/\/repos\/[^/]+\/[^/]+\/pulls\?/.test(url)) {
        return jsonResponse([]);
      }
      throw new Error(`unexpected fetch in archive-pull suite: ${url}`);
    }),
  );
}

async function seedPr(handle: AppDatabase, ctx: ScopeContext): Promise<void> {
  await createTenantRepository(handle, ctx).pullRequests.upsert({
    repoId: brandRepoId(BigInt(REPO_ID)),
    prNumber: PR_NUMBER,
    repoSlug: REPO_SLUG,
    state: PrStates.OPEN,
  });
}

async function readArchivedReviewers(
  harness: PgliteHarness,
): Promise<string[]> {
  const rows = await harness.raw("select reviewer_id from inbox_archive");
  return rows.map((row) => String(row["reviewer_id"]));
}

async function readAuditOperations(harness: PgliteHarness): Promise<string[]> {
  const rows = await harness.raw(
    "select operation from audit_log where outcome = 'ok' order by id",
  );
  return rows.map((row) => String(row["operation"]));
}

describe("PUT and DELETE /api/repos/:repoId/pulls/:prNumber/archive", () => {
  let harness: PgliteHarness;
  let kp: KeyProvider;
  let fake: FakeGitHub;
  let app: ApiApp;

  beforeEach(async () => {
    harness = await createPgliteHarness();
    kp = createKeyProvider();
    fake = makeFakeGitHub();
    app = createApp({
      logger: testLogger(),
      handle: harness.handle,
      webhookSecret: SECRET,
      auth: buildFakeAuthDeps(kp, fake),
      ...UNUSED_INSTALLATION_DEPS,
    });
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await harness.close();
  });

  function cookieHeaders(cookie: string): Record<string, string> {
    return {
      ...SAME_ORIGIN_HEADERS,
      Cookie: `__Host-mergebrief_session=${cookie}`,
    };
  }

  async function archive(cookie: string, method: "PUT" | "DELETE") {
    return app.request(ARCHIVE_PATH, {
      method,
      headers: cookieHeaders(cookie),
    });
  }

  async function listNumbers(cookie: string, search = ""): Promise<number[]> {
    const res = await app.request(`/api/inbox${search}`, {
      headers: cookieHeaders(cookie),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: { prNumber: number }[];
      archivedTotal: number;
    };
    return body.items.map((item) => item.prNumber);
  }

  it("archives an installation row for the viewer and unarchives it again", async () => {
    stubGitHub(true);
    await seedPr(harness.handle, TENANT);
    const { cookie } = await seedSignIn(harness.handle, kp, { scope: OWNER });

    const put = await archive(cookie, "PUT");
    expect(put.status).toBe(200);
    expect(await put.json()).toEqual({ ok: true });
    expect(fake.calls).toEqual([]);
    expect(await readArchivedReviewers(harness)).toEqual([String(REVIEWER_ID)]);
    expect(await listNumbers(cookie)).toEqual([]);
    expect(await listNumbers(cookie, "?archived=only")).toEqual([PR_NUMBER]);

    const callsBeforeDelete = fake.calls.length;
    const del = await archive(cookie, "DELETE");
    expect(del.status).toBe(200);
    expect(fake.calls).toHaveLength(callsBeforeDelete);
    expect(await readArchivedReviewers(harness)).toEqual([]);
    expect(await listNumbers(cookie)).toEqual([PR_NUMBER]);

    expect(await readAuditOperations(harness)).toEqual([
      "archive-pull",
      "unarchive-pull",
    ]);
  });

  it("reads the row once per archive request", async () => {
    stubGitHub(true);
    await seedPr(harness.handle, TENANT);
    const { cookie } = await seedSignIn(harness.handle, kp, { scope: OWNER });
    const lookups = spyPullRequestLookups(harness);

    const put = await archive(cookie, "PUT");

    expect(put.status).toBe(200);
    expect(lookups.count()).toBe(1);
  });

  it("the inbox reports the archived total beside the total", async () => {
    stubGitHub(true);
    await seedPr(harness.handle, TENANT);
    const { cookie } = await seedSignIn(harness.handle, kp, { scope: OWNER });
    await archive(cookie, "PUT");

    const res = await app.request("/api/inbox", {
      headers: cookieHeaders(cookie),
    });

    expect(await res.json()).toMatchObject({ total: 0, archivedTotal: 1 });
  });

  it("archives the viewer's own url row through the owner world", async () => {
    stubGitHub(false);
    await seedPr(harness.handle, OWNER);
    const { cookie } = await seedSignIn(harness.handle, kp, { scope: OWNER });

    const put = await archive(cookie, "PUT");

    expect(put.status).toBe(200);
    const rows = await harness.raw("select installation_id from inbox_archive");
    expect(rows).toEqual([{ installation_id: null }]);
  });

  it("archiving another owner's url row is the viewer's alone", async () => {
    stubGitHub(false);
    await seedPr(harness.handle, OTHER_OWNER);
    const { cookie } = await seedSignIn(harness.handle, kp, { scope: OWNER });

    const put = await archive(cookie, "PUT");

    expect(put.status).toBe(200);
    expect(await readArchivedReviewers(harness)).toEqual([String(REVIEWER_ID)]);
    const rows = await harness.raw("select installation_id from inbox_archive");
    expect(rows).toEqual([{ installation_id: null }]);
    const owner = await createInboxStore(harness.handle).list({
      installationIds: [],
      allowedRepoIds: [],
      ownerUserId: brandReviewerId(BigInt(OTHER_REVIEWER_ID)),
      reviewerId: brandReviewerId(BigInt(OTHER_REVIEWER_ID)),
      reviewerLogin: null,
      filters: {
        statuses: [],
        author: InboxAuthorFilters.ALL,
        archived: InboxArchivedFilters.HIDE,
      },
      sort: InboxSorts.UPDATED,
      layout: InboxLayouts.FOLDED,
      page: 1,
      pageSize: 10,
    });
    expect(owner.items.map((item) => item.pullRequest.prNumber)).toEqual([
      PR_NUMBER,
    ]);
  });

  it("an unknown pull request is a 404 either way", async () => {
    stubGitHub(true);
    const { cookie } = await seedSignIn(harness.handle, kp, { scope: OWNER });

    expect((await archive(cookie, "PUT")).status).toBe(404);
    expect((await archive(cookie, "DELETE")).status).toBe(404);
    expect(await readArchivedReviewers(harness)).toEqual([]);
  });

  it("a private-write Bearer principal may archive", async () => {
    stubGitHub(true);
    await seedPr(harness.handle, TENANT);
    const bearer = await seedApiToken(
      harness.handle,
      kp,
      WriteClassifications.PRIVATE_WRITE,
    );

    const res = await app.request(ARCHIVE_PATH, {
      method: "PUT",
      headers: { Authorization: `Bearer ${bearer}` },
    });

    expect(res.status).toBe(200);
    expect(await readArchivedReviewers(harness)).toHaveLength(1);
  });

  it("a read-only Bearer principal is refused by scope", async () => {
    stubGitHub(true);
    await seedPr(harness.handle, TENANT);
    const bearer = await seedApiToken(
      harness.handle,
      kp,
      WriteClassifications.READ,
    );

    const res = await app.request(ARCHIVE_PATH, {
      method: "PUT",
      headers: { Authorization: `Bearer ${bearer}` },
    });

    expect(res.status).toBe(403);
    expect(((await res.json()) as { code?: string }).code).toBe(
      "scope-exceeded",
    );
  });
});
