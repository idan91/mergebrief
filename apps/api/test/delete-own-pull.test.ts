// DELETE /api/inbox/:repoId/:prNumber, the owner-only purge of one pasted
// row. Full wire over PGlite. Session-gated only, no GitHub call at all:
// ownership under the viewer's owner scope is the wall, so a pasted row
// whose repository nobody can read any more still goes, and the erase
// cascades every artifact.
import { makeFakeGitHub, type FakeGitHub } from "github/testing";
import {
  createArtifactStore,
  createTenantRepository,
  isInstallationId,
  isRepoId,
  isReviewerId,
  type AppDatabase,
  type KeyProvider,
  type RepoId,
  type ReviewerId,
  type ScopeContext,
} from "persistence";
import { PrStates } from "types";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp, type ApiApp, type AppDeps } from "../src/index";
import { testLogger } from "./logging";
import { SECRET, createKeyProvider, SAME_ORIGIN_HEADERS } from "./fixtures";
import {
  spyPullRequestLookups,
  type PullRequestLookups,
} from "./pull-request-lookups";
import {
  UNUSED_INSTALLATION_DEPS,
  buildFakeAuthDeps,
  stubNoNetwork,
} from "./reviewer-github";
import { seedSignIn } from "./sign-in";
import { registerSharedPglite, type SharedPglite } from "./shared-pglite";
import { STORED_BODY_VERSION } from "brief-core/artifact";

const REPO_ID_NUM = 424242;
const PR_NUMBER = 7;

function brand<Branded extends bigint>(
  guard: (value: bigint) => value is Branded,
  value: number,
): Branded {
  const asBigInt = BigInt(value);
  if (!guard(asBigInt)) {
    throw new Error("bad branded id");
  }
  return asBigInt;
}

const REVIEWER: ReviewerId = brand(isReviewerId, 555);
const OTHER_REVIEWER: ReviewerId = brand(isReviewerId, 999);
const REPO: RepoId = brand(isRepoId, REPO_ID_NUM);
const OWNER_CTX: ScopeContext = { ownerUserId: REVIEWER };
const OTHER_OWNER_CTX: ScopeContext = { ownerUserId: OTHER_REVIEWER };
const TENANT_CTX: ScopeContext = {
  installationId: brand(isInstallationId, 987654),
};

async function seedBriefedPr(
  handle: AppDatabase,
  ctx: ScopeContext,
): Promise<void> {
  const pr = await createTenantRepository(handle, ctx).pullRequests.upsert({
    repoId: REPO,
    prNumber: PR_NUMBER,
    repoSlug: "o/r",
    state: PrStates.OPEN,
  });
  await createArtifactStore(handle, ctx).briefs.write({
    pullRequestId: pr.id,
    baseSha: "b".repeat(40),
    headSha: "h".repeat(40),
    headIndex: 1,
    commitCount: 1,
    provider: "p",
    model: "m",
    effort: "e",
    bodyVersion: STORED_BODY_VERSION,
    body: "{}",
    usedGroupIds: [],
  });
}

interface AuditRow {
  readonly installation_id: unknown;
  readonly source: string;
  readonly operation: string;
  readonly outcome: string;
  readonly actor_type: string;
}

async function readAudits(harness: SharedPglite): Promise<AuditRow[]> {
  const rows = await harness.raw(
    "select installation_id, source, operation, outcome, actor_type from audit_log order by id",
  );
  return rows.map((row) => ({
    installation_id: row["installation_id"],
    source: String(row["source"]),
    operation: String(row["operation"]),
    outcome: String(row["outcome"]),
    actor_type: String(row["actor_type"]),
  }));
}

async function countRows(
  harness: SharedPglite,
  table: string,
): Promise<number> {
  return (await harness.raw(`select id from ${table}`)).length;
}

describe("DELETE /api/inbox/:repoId/:prNumber", () => {
  const harness = registerSharedPglite();
  let kp: KeyProvider;
  let app: ApiApp;
  let fake: FakeGitHub;
  let lookups: PullRequestLookups;

  beforeEach(() => {
    kp = createKeyProvider();
    fake = makeFakeGitHub();
    lookups = spyPullRequestLookups(harness);
    const deps: AppDeps = {
      logger: testLogger(),
      handle: harness.handle,
      webhookSecret: SECRET,
      auth: buildFakeAuthDeps(kp, fake),
      ...UNUSED_INSTALLATION_DEPS,
    };
    app = createApp(deps);
    stubNoNetwork();
  });

  async function del(
    cookie: string,
    headers: Record<string, string> = SAME_ORIGIN_HEADERS,
  ): Promise<Response> {
    return app.request(`/api/inbox/${REPO_ID_NUM}/${PR_NUMBER}`, {
      method: "DELETE",
      headers: { ...headers, Cookie: `__Host-mergebrief_session=${cookie}` },
    });
  }

  it("erases the viewer's own pasted row with no GitHub call", async () => {
    await seedBriefedPr(harness.handle, OWNER_CTX);
    const { cookie } = await seedSignIn(harness.handle, kp);

    const res = await del(cookie);

    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(fake.calls).toEqual([]);
    expect(lookups.count()).toBe(1);
    expect(await countRows(harness, "pull_request")).toBe(0);
    expect(await countRows(harness, "brief")).toBe(0);
    const audits = await readAudits(harness);
    expect(audits).toContainEqual({
      installation_id: null,
      source: "url",
      operation: "delete",
      outcome: "ok",
      actor_type: "reviewer",
    });
    expect(audits).toContainEqual(
      expect.objectContaining({
        installation_id: null,
        source: "url",
        operation: "delete-own-pull",
        outcome: "ok",
      }),
    );
  });

  it("a tenant row at the same coordinates is an indistinguishable 404", async () => {
    await seedBriefedPr(harness.handle, TENANT_CTX);
    const { cookie } = await seedSignIn(harness.handle, kp);

    const res = await del(cookie);

    expect(res.status).toBe(404);
    expect(await countRows(harness, "pull_request")).toBe(1);
    expect(await countRows(harness, "brief")).toBe(1);
  });

  it("another reviewer's pasted row at the coordinates survives", async () => {
    await seedBriefedPr(harness.handle, OTHER_OWNER_CTX);
    const { cookie } = await seedSignIn(harness.handle, kp);

    const res = await del(cookie);

    expect(res.status).toBe(404);
    expect(await countRows(harness, "pull_request")).toBe(1);
  });

  it("a cross-origin cookie request is forbidden", async () => {
    await seedBriefedPr(harness.handle, OWNER_CTX);
    const { cookie } = await seedSignIn(harness.handle, kp);

    const res = await del(cookie, {
      "sec-fetch-site": "cross-site",
      origin: "https://evil.example.test",
    });

    expect(res.status).toBe(403);
    expect(await countRows(harness, "pull_request")).toBe(1);
  });

  it("a malformed repository id is a 404, a bad number a 400", async () => {
    const { cookie } = await seedSignIn(harness.handle, kp);

    const bad = await app.request("/api/inbox/not-an-id/7", {
      method: "DELETE",
      headers: {
        ...SAME_ORIGIN_HEADERS,
        Cookie: `__Host-mergebrief_session=${cookie}`,
      },
    });
    const zero = await app.request(`/api/inbox/${REPO_ID_NUM}/0`, {
      method: "DELETE",
      headers: {
        ...SAME_ORIGIN_HEADERS,
        Cookie: `__Host-mergebrief_session=${cookie}`,
      },
    });

    expect(bad.status).toBe(404);
    expect(zero.status).toBe(400);
  });
});
