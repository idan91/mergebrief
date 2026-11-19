// POST /api/repos/:repoId/pulls/:prNumber/archive and .../unarchive: the
// viewer's own archive of one inbox row, behind the per-PR gate, per
// reviewer. Full wire over PGlite. The archive makes no GitHub call, so the
// fake sees nothing past the gate's own reads.
import { makeFakeGitHub, type FakeGitHub } from "github/testing";
import {
  createInboxStore,
  createTenantRepository,
  type AppDatabase,
  type KeyProvider,
  type ScopeContext,
} from "persistence";
import {
  InboxArchivedFilters,
  InboxAuthorFilters,
  InboxLayouts,
  InboxSortDirections,
  InboxSorts,
  PrStates,
  AccessLevels,
} from "types";
import { beforeEach, describe, expect, it, vi } from "vitest";
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
  SAME_ORIGIN_HEADERS,
} from "./fixtures";
import { spyPullRequestLookups } from "./pull-request-lookups";
import {
  UNUSED_INSTALLATION_DEPS,
  arrangeFakeGate,
  buildFakeAuthDeps,
  listCallsPastGate,
} from "./reviewer-github";
import { seedSignIn, seedApiToken } from "./sign-in";
import { registerSharedPglite, type SharedPglite } from "./shared-pglite";

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

const PULL_PATH = `/api/repos/${REPO_ID}/pulls/${PR_NUMBER}`;
const ARCHIVE_PATH = `${PULL_PATH}/archive`;
const UNARCHIVE_PATH = `${PULL_PATH}/unarchive`;

/** The gate's repo, in the installation or in none. */
function arrangeGate(fake: FakeGitHub, inInstallation: boolean): void {
  arrangeFakeGate(fake, { repoId: REPO_ID, inInstallation });
}

async function seedPr(handle: AppDatabase, ctx: ScopeContext): Promise<void> {
  await createTenantRepository(handle, ctx).pullRequests.upsert({
    repoId: brandRepoId(BigInt(REPO_ID)),
    prNumber: PR_NUMBER,
    repoSlug: REPO_SLUG,
    state: PrStates.OPEN,
  });
}

async function readArchivedReviewers(harness: SharedPglite): Promise<string[]> {
  const rows = await harness.raw("select reviewer_id from inbox_archive");
  return rows.map((row) => String(row["reviewer_id"]));
}

async function readAuditOperations(harness: SharedPglite): Promise<string[]> {
  const rows = await harness.raw(
    "select operation from audit_log where outcome = 'ok' order by id",
  );
  return rows.map((row) => String(row["operation"]));
}

describe("POST /api/repos/:repoId/pulls/:prNumber/archive and /unarchive", () => {
  const harness = registerSharedPglite();
  let kp: KeyProvider;
  let fake: FakeGitHub;
  let app: ApiApp;

  beforeEach(() => {
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

  function cookieHeaders(cookie: string): Record<string, string> {
    return {
      ...SAME_ORIGIN_HEADERS,
      Cookie: `__Host-mergebrief_session=${cookie}`,
    };
  }

  async function archive(cookie: string, path = ARCHIVE_PATH) {
    return app.request(path, {
      method: "POST",
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
    arrangeGate(fake, true);
    await seedPr(harness.handle, TENANT);
    const { cookie } = await seedSignIn(harness.handle, kp);

    const put = await archive(cookie);
    expect(put.status).toBe(204);
    expect(await put.text()).toBe("");
    expect(put.headers.get("cache-control")).toBe("no-store");
    expect(listCallsPastGate(fake)).toEqual([]);
    expect(await readArchivedReviewers(harness)).toEqual([String(REVIEWER_ID)]);
    expect(await listNumbers(cookie)).toEqual([]);
    expect(await listNumbers(cookie, "?archived=only")).toEqual([PR_NUMBER]);

    const callsBeforeDelete = fake.calls.length;
    const del = await archive(cookie, UNARCHIVE_PATH);
    expect(del.status).toBe(204);
    expect(await del.text()).toBe("");
    expect(fake.calls).toHaveLength(callsBeforeDelete);
    expect(await readArchivedReviewers(harness)).toEqual([]);
    expect(await listNumbers(cookie)).toEqual([PR_NUMBER]);

    expect(await readAuditOperations(harness)).toEqual([
      "archive-pull",
      "unarchive-pull",
    ]);
  });

  it("reads the row once per archive request", async () => {
    arrangeGate(fake, true);
    await seedPr(harness.handle, TENANT);
    const { cookie } = await seedSignIn(harness.handle, kp);
    const lookups = spyPullRequestLookups(harness);

    const put = await archive(cookie);

    expect(put.status).toBe(204);
    expect(lookups.count()).toBe(1);
  });

  it("the inbox reports the archived total beside the total", async () => {
    arrangeGate(fake, true);
    await seedPr(harness.handle, TENANT);
    const { cookie } = await seedSignIn(harness.handle, kp);
    await archive(cookie);

    const res = await app.request("/api/inbox", {
      headers: cookieHeaders(cookie),
    });

    expect(await res.json()).toMatchObject({ total: 0, archivedTotal: 1 });
  });

  it("archives the viewer's own url row through the owner world", async () => {
    arrangeGate(fake, false);
    await seedPr(harness.handle, OWNER);
    const { cookie } = await seedSignIn(harness.handle, kp);

    const put = await archive(cookie);

    expect(put.status).toBe(204);
    const rows = await harness.raw("select installation_id from inbox_archive");
    expect(rows).toEqual([{ installation_id: null }]);
  });

  it("archiving another owner's url row is the viewer's alone", async () => {
    arrangeGate(fake, false);
    await seedPr(harness.handle, OTHER_OWNER);
    const { cookie } = await seedSignIn(harness.handle, kp);

    const put = await archive(cookie);

    expect(put.status).toBe(204);
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
      direction: InboxSortDirections.DESCENDING,
      layout: InboxLayouts.FOLDED,
      page: 1,
      pageSize: 10,
    });
    expect(owner.items.map((item) => item.pullRequest.prNumber)).toEqual([
      PR_NUMBER,
    ]);
  });

  it("a private-write Bearer principal may archive", async () => {
    arrangeGate(fake, true);
    await seedPr(harness.handle, TENANT);
    const bearer = await seedApiToken(
      harness.handle,
      kp,
      AccessLevels.PRIVATE_WRITE,
    );

    const res = await app.request(ARCHIVE_PATH, {
      method: "POST",
      headers: { Authorization: `Bearer ${bearer}` },
    });

    expect(res.status).toBe(204);
    expect(await readArchivedReviewers(harness)).toHaveLength(1);
  });

  it("a read-only Bearer principal is refused by scope", async () => {
    arrangeGate(fake, true);
    await seedPr(harness.handle, TENANT);
    const bearer = await seedApiToken(harness.handle, kp, AccessLevels.READ);

    const res = await app.request(ARCHIVE_PATH, {
      method: "POST",
      headers: { Authorization: `Bearer ${bearer}` },
    });

    expect(res.status).toBe(403);
    expect(((await res.json()) as { code?: string }).code).toBe(
      "scope-exceeded",
    );
  });
});
