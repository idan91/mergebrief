// POST /api/generate route tests: the url-box door end to end over PGlite,
// viewer-token resolve on the `github/testing` fake, owner-scoped upsert,
// and the enqueued worker job. The read-backs pass the repo gate, whose own
// reads still go over `fetch`.
import {
  CredentialKinds,
  FakeFailures,
  makeFakeGitHub,
  type FakeGitHub,
} from "github/testing";
import { RequestBounds } from "contract";
import {
  createTenantRepository,
  isInstallationId,
  isRepoId,
  isReviewerId,
  type KeyProvider,
  type ReviewerId,
} from "persistence";
import { createPgliteHarness, type PgliteHarness } from "persistence/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, type ApiApp, type AppDeps } from "../src/index";
import { testLogger } from "./logging";
import { spyPullRequestLookups } from "./pull-request-lookups";
import {
  SECRET,
  buildOperatorToken,
  createKeyProvider,
  SAME_ORIGIN_HEADERS,
} from "./fixtures";
import {
  ROTATED_ACCESS_TOKEN,
  UNUSED_INSTALLATION_DEPS,
  buildFakeAuthDeps,
  listFakeCallTokens,
  makeFakePullRequestInfo,
  arrangeFakeGate,
} from "./reviewer-github";
import { ACCESS_TOKEN, seedSignIn } from "./sign-in";

const FALLBACK_PAT = "ghp_OPERATOR_PAT";
const PR_URL = "https://github.com/o/r/pull/7";
const PR_REF = { owner: "o", repo: "r", prNumber: 7 };
const HEAD = "a".repeat(40);
const LIVE_HEAD = "c".repeat(40);
const BASE = "b".repeat(40);
const REPO_ID = 424242;

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
const OTHER_REVIEWER: ReviewerId = brand(isReviewerId, 556);

interface PastedPull {
  readonly merged?: boolean;
}

/** The pasted pull request as GitHub holds it. */
function arrangePastedPull(fake: FakeGitHub, pasted: PastedPull = {}): void {
  const merged = pasted.merged === true;
  const info = {
    ...makeFakePullRequestInfo({ repoId: REPO_ID }),
    repoFullName: "o/r",
    headSha: HEAD,
    baseSha: BASE,
    state: merged ? ("closed" as const) : ("open" as const),
    merged,
    title: "Add thing",
    htmlUrl: PR_URL,
    commitCount: 3,
    closedAt: merged ? new Date("2026-08-01T00:00:00Z") : null,
    updatedAt: new Date("2026-09-20T10:00:00Z"),
  };
  fake.addPullRequest(PR_REF, { info });
}

/** The tokens the paste's pull request reads carried, in order. */
function listPullReadTokens(fake: FakeGitHub): string[] {
  return fake
    .listCalls("fetchPullRequest")
    .map((call) => ("token" in call.credential ? call.credential.token : ""));
}

/** An owner-world sign-in with no installation: the url-box viewer's shape. */
async function seedOwnerSignIn(
  harness: PgliteHarness,
  kp: KeyProvider,
  reviewer: ReviewerId = REVIEWER,
): Promise<string> {
  const { cookie } = await seedSignIn(harness.handle, kp, {
    reviewer: { id: reviewer, login: "octocat" },
  });
  return cookie;
}

async function post(
  app: ApiApp,
  cookie: string | undefined,
  url: string,
): Promise<Response> {
  const headers: Record<string, string> = {
    ...SAME_ORIGIN_HEADERS,
    "content-type": "application/json",
  };
  if (cookie !== undefined) {
    headers["Cookie"] = `__Host-mergebrief_session=${cookie}`;
  }
  return app.request("/api/generate", {
    method: "POST",
    body: JSON.stringify({ url }),
    headers,
  });
}

describe("POST /api/generate: the url-box door", () => {
  let harness: PgliteHarness;
  let kp: KeyProvider;
  let fake: FakeGitHub;

  beforeEach(async () => {
    harness = await createPgliteHarness();
    kp = createKeyProvider();
    fake = makeFakeGitHub();
    arrangeFakeGate(fake, { repoId: REPO_ID, fullName: "o/r" });
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await harness.close();
  });

  function buildApp(
    fallbackToken?: string,
    tokenOwnerId: number = Number(REVIEWER),
  ): ApiApp {
    const deps: AppDeps = {
      logger: testLogger(),
      handle: harness.handle,
      webhookSecret: SECRET,
      auth: buildFakeAuthDeps(kp, fake),
      ...UNUSED_INSTALLATION_DEPS,
      operatorToken:
        fallbackToken === undefined
          ? undefined
          : buildOperatorToken(fallbackToken, tokenOwnerId),
    };
    return createApp(deps);
  }

  it("401 with no session", async () => {
    arrangePastedPull(fake);
    const res = await post(buildApp(), undefined, PR_URL);
    expect(res.status).toBe(401);
    expect(fake.calls).toEqual([]);
  });

  it("400 for a non-PR url", async () => {
    arrangePastedPull(fake);
    const cookie = await seedOwnerSignIn(harness, kp);
    const res = await post(buildApp(), cookie, "https://example.com/nope");
    expect(res.status).toBe(400);
  });

  it("400s a url past the contract bound before any GitHub call", async () => {
    arrangePastedPull(fake);
    const cookie = await seedOwnerSignIn(harness, kp);
    const padding = "x".repeat(RequestBounds.GENERATE_URL_LENGTH);
    const res = await post(buildApp(), cookie, `${PR_URL}?${padding}`);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "invalid-request" });
    expect(listPullReadTokens(fake)).toEqual([]);
  });

  it("202s the paste, upserts the owner row, enqueues the job", async () => {
    arrangePastedPull(fake, { merged: true });
    const cookie = await seedOwnerSignIn(harness, kp);
    const lookups = spyPullRequestLookups(harness);
    const res = await post(buildApp(), cookie, PR_URL);
    expect(res.status).toBe(202);
    expect(lookups.count()).toBe(0);
    expect(await res.json()).toEqual({
      repoId: String(REPO_ID),
      prNumber: 7,
    });
    expect(listPullReadTokens(fake)).toEqual([ACCESS_TOKEN]);

    const rows = await harness.raw(
      "select installation_id, owner_user_id, source, state, repo_slug, title from pull_request",
    );
    expect(rows).toEqual([
      {
        installation_id: null,
        owner_user_id: Number(REVIEWER),
        source: "url",
        // A merged PR is a first-class url-box target, and still enqueues.
        state: "merged",
        repo_slug: "o/r",
        title: "Add thing",
      },
    ]);

    const generations = await harness.raw(
      "select status, head_sha from generation",
    );
    expect(generations).toEqual([{ status: "pending", head_sha: HEAD }]);
    // The paste is the row's first live read.
    const stamps = await harness.raw(
      "select github_head_sha, github_read_at is not null as read from pull_request",
    );
    expect(stamps).toEqual([{ github_head_sha: HEAD, read: true }]);

    const jobs = await harness.raw(
      "select payload, run_at from graphile_worker.jobs where task_identifier = 'generate'",
    );
    expect(jobs).toHaveLength(1);
    const payload = jobs[0]?.["payload"];
    expect(payload).toMatchObject({
      owner_user_id: String(REVIEWER),
      pull_request_id: expect.stringMatching(/^\d+$/),
      head_sha: HEAD,
    });
    expect(
      typeof payload === "object" && payload !== null && "grant_id" in payload,
    ).toBe(true);
    // A paste takes the short trailing window, never zero: a claimed job
    // cannot be replaced, so an immediate re-paste would generate twice.
    const runAt = new Date(String(jobs[0]?.["run_at"]));
    const delaySeconds = (runAt.getTime() - Date.now()) / 1000;
    expect(delaySeconds).toBeGreaterThan(1);
    expect(delaySeconds).toBeLessThanOrEqual(30);

    const audits = await harness.raw(
      "select installation_id, source, operation, outcome from audit_log",
    );
    expect(audits).toContainEqual({
      installation_id: null,
      source: "url",
      operation: "generate-brief",
      outcome: "ok",
    });
  });

  it("an installation-bound paste lands owner-world and reads back", async () => {
    arrangePastedPull(fake);
    const { cookie } = await seedSignIn(harness.handle, kp);
    const app = buildApp();

    const res = await post(app, cookie, PR_URL);
    expect(res.status).toBe(202);
    const rows = await harness.raw(
      "select installation_id, owner_user_id from pull_request",
    );
    expect(rows).toEqual([
      { installation_id: null, owner_user_id: Number(REVIEWER) },
    ]);

    // The read-back: the tenant ctx misses and the owner fallback resolves,
    // the poll-after-paste loop must work for exactly this viewer.
    const meta = await app.request(`/api/repos/${REPO_ID}/pulls/7`, {
      headers: { Cookie: `__Host-mergebrief_session=${cookie}` },
    });
    expect(meta.status).toBe(200);
    const body: unknown = await meta.json();
    expect(body).toMatchObject({
      repoId: String(REPO_ID),
      prNumber: 7,
      briefAvailable: false,
      generation: { status: "pending" },
    });
  });

  it("opening a url brief reads GitHub live once the row is stale", async () => {
    arrangePastedPull(fake);
    const cookie = await seedOwnerSignIn(harness, kp);
    const app = buildApp();
    expect((await post(app, cookie, PR_URL)).status).toBe(202);

    const fresh = await app.request(`/api/repos/${REPO_ID}/pulls/7`, {
      headers: { Cookie: `__Host-mergebrief_session=${cookie}` },
    });
    expect(fresh.status).toBe(200);
    expect(fake.listCalls("readPullRequestFacts")).toHaveLength(0);

    fake.updatePullRequest(PR_REF, { title: "Live title", headSha: LIVE_HEAD });
    await harness.raw(
      "update pull_request set github_read_at = now() - interval '10 minutes'",
    );
    const stale = await app.request(`/api/repos/${REPO_ID}/pulls/7`, {
      headers: { Cookie: `__Host-mergebrief_session=${cookie}` },
    });
    expect(stale.status).toBe(200);
    expect(fake.listCalls("readPullRequestFacts")).toHaveLength(1);
    const rows = await harness.raw(
      "select title, github_head_sha from pull_request",
    );
    expect(rows).toEqual([{ title: "Live title", github_head_sha: LIVE_HEAD }]);
  });

  it("when BOTH worlds hold the row, the tenant world wins the read-back", async () => {
    const tenantCtx = { installationId: brand(isInstallationId, 987654) };
    // Seed the SAME coordinates in both worlds; only the tenant row carries
    // the marker slug.
    await createTenantRepository(harness.handle, tenantCtx).pullRequests.upsert(
      {
        repoId: brand(isRepoId, REPO_ID),
        prNumber: 7,
        repoSlug: "o/r",
        title: "tenant title",
        state: "open",
      },
    );
    await createTenantRepository(harness.handle, {
      ownerUserId: REVIEWER,
    }).pullRequests.upsert({
      repoId: brand(isRepoId, REPO_ID),
      prNumber: 7,
      repoSlug: "o/r",
      title: "owner title",
      state: "open",
    });
    const { cookie } = await seedSignIn(harness.handle, kp);

    const meta = await buildApp().request(`/api/repos/${REPO_ID}/pulls/7`, {
      headers: { Cookie: `__Host-mergebrief_session=${cookie}` },
    });
    expect(meta.status).toBe(200);
    // The stored title is the row marker, so the tenant row must win.
    expect(await meta.json()).toMatchObject({ title: "tenant title" });
  });

  it("a second signed-in reader opens the url-box row another viewer pasted", async () => {
    // Url-box rows are instance-visible: the gate already made this reader
    // prove GitHub access to the repo, and the row is theirs to read.
    arrangePastedPull(fake);
    const app = buildApp();
    const pasted = await post(app, await seedOwnerSignIn(harness, kp), PR_URL);
    expect(pasted.status).toBe(202);

    const other = await seedOwnerSignIn(harness, kp, OTHER_REVIEWER);
    const meta = await app.request(`/api/repos/${REPO_ID}/pulls/7`, {
      headers: { Cookie: `__Host-mergebrief_session=${other}` },
    });

    expect(meta.status).toBe(200);
    expect(await meta.json()).toMatchObject({ prNumber: 7 });
  });

  it("re-pasting replaces the pending job instead of stacking a second", async () => {
    arrangePastedPull(fake);
    const cookie = await seedOwnerSignIn(harness, kp);
    const app = buildApp();
    expect((await post(app, cookie, PR_URL)).status).toBe(202);
    const first = await harness.raw(
      "select run_at from graphile_worker.jobs where task_identifier = 'generate'",
    );
    expect((await post(app, cookie, PR_URL)).status).toBe(202);

    const prs = await harness.raw("select id from pull_request");
    expect(prs).toHaveLength(1);
    const jobs = await harness.raw(
      "select id, run_at from graphile_worker.jobs where task_identifier = 'generate'",
    );
    expect(jobs).toHaveLength(1);
    // Trailing, not fixed: the re-paste re-schedules the one job off the LAST
    // trigger, so its window never runs down while pastes keep arriving.
    const rescheduled = new Date(String(jobs[0]?.["run_at"])).getTime();
    expect(rescheduled).toBeGreaterThanOrEqual(
      new Date(String(first[0]?.["run_at"])).getTime(),
    );
    expect(rescheduled).toBeGreaterThan(Date.now() + 1000);
  });

  it("an expired viewer token spends the one refresh and retries rotated", async () => {
    arrangePastedPull(fake);
    fake.rejectToken(ACCESS_TOKEN);
    const cookie = await seedOwnerSignIn(harness, kp);
    // The PAT is CONFIGURED here so the assertion genuinely excludes it: a
    // 401 must spend the refresh, never escalate to the operator identity.
    const res = await post(buildApp(FALLBACK_PAT), cookie, PR_URL);
    expect(res.status).toBe(202);
    expect(listPullReadTokens(fake)).toEqual([
      ACCESS_TOKEN,
      ROTATED_ACCESS_TOKEN,
    ]);
  });

  it("a token that will not decrypt is a 401 and burns the session", async () => {
    arrangePastedPull(fake);
    const { cookie, cookieHash } = await seedSignIn(harness.handle, kp);
    await harness.raw("update github_grant set gh_token_ciphertext = 'sealed'");

    const res = await post(buildApp(FALLBACK_PAT), cookie, PR_URL);

    expect(res.status).toBe(401);
    expect(fake.calls).toEqual([]);
    const sessions = await harness.raw(
      "select id from auth_session where session_token_hash = $1",
      [cookieHash],
    );
    expect(sessions).toEqual([]);
  });

  it("a viewer denial with no PAT collapses to the uniform 404", async () => {
    arrangePastedPull(fake);
    fake.failOn("fetchPullRequest", FakeFailures.NOT_FOUND);
    const cookie = await seedOwnerSignIn(harness, kp);
    const res = await post(buildApp(), cookie, PR_URL);
    expect(res.status).toBe(404);
    expect(await harness.raw("select id from pull_request")).toHaveLength(0);
  });

  it("a viewer 403 collapses to the uniform 404", async () => {
    arrangePastedPull(fake);
    fake.failOn("fetchPullRequest", FakeFailures.FORBIDDEN);
    const cookie = await seedOwnerSignIn(harness, kp);
    const res = await post(buildApp(), cookie, PR_URL);
    expect(res.status).toBe(404);
  });

  it("a viewer denial retries once with the operator PAT", async () => {
    arrangePastedPull(fake);
    fake.failOn(
      "fetchPullRequest",
      FakeFailures.NOT_FOUND,
      CredentialKinds.REVIEWER,
    );
    const cookie = await seedOwnerSignIn(harness, kp);
    const res = await post(buildApp(FALLBACK_PAT), cookie, PR_URL);
    expect(res.status).toBe(202);
    expect(listPullReadTokens(fake)).toEqual([ACCESS_TOKEN, FALLBACK_PAT]);
  });

  it("answers a non-owner as if no operator PAT were set", async () => {
    arrangePastedPull(fake);
    fake.failOn(
      "fetchPullRequest",
      FakeFailures.NOT_FOUND,
      CredentialKinds.REVIEWER,
    );
    const cookie = await seedOwnerSignIn(harness, kp);

    const nonOwnerApp = buildApp(FALLBACK_PAT, Number(OTHER_REVIEWER));
    const nonOwner = await post(nonOwnerApp, cookie, PR_URL);
    const sentTokens = listFakeCallTokens(fake);
    const unconfigured = await post(buildApp(), cookie, PR_URL);

    expect(sentTokens).toEqual([ACCESS_TOKEN]);
    expect(nonOwner.status).toBe(unconfigured.status);
    expect(await nonOwner.json()).toEqual(await unconfigured.json());
    expect(await harness.raw("select id from pull_request")).toHaveLength(0);
  });

  // A 401 from the OPERATOR's key is not the reader's expiry: it must not
  // spend the request's one refresh, and it must not send the reader to
  // re-authenticate a credential that is not theirs.
  it("keeps the reader's 404 when the operator PAT is itself rejected", async () => {
    arrangePastedPull(fake);
    fake.failOn(
      "fetchPullRequest",
      FakeFailures.NOT_FOUND,
      CredentialKinds.REVIEWER,
    );
    fake.rejectToken(FALLBACK_PAT);
    const cookie = await seedOwnerSignIn(harness, kp);

    const res = await post(buildApp(FALLBACK_PAT), cookie, PR_URL);

    expect(res.status).toBe(404);
    // One viewer read, one PAT read, and NO rotated-token retry.
    expect(listPullReadTokens(fake)).toEqual([ACCESS_TOKEN, FALLBACK_PAT]);
  });
});
