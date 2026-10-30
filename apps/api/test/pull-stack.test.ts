// GET .../stack over PGlite: the PR's stack from the repo's open list on the
// viewer's binding (the `github/testing` fake), folded into the row's record.
import {
  CredentialKinds,
  FakeFailures,
  makeFakeGitHub,
  type FakeGitHub,
} from "github/testing";
import {
  createTenantRepository,
  type AppDatabase,
  type KeyProvider,
  type PullRequestRow,
} from "persistence";
import { PrStates } from "types/pull-requests";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, type ApiApp, type AuthDeps } from "../src/index";
import {
  INSTALLATION_ID,
  PR_NUMBER,
  REPO_SLUG,
  SECRET,
  brandInstallationId,
  brandRepoId,
  createKeyProvider,
} from "./fixtures";
import { testLogger, testLogging, type TestLogging } from "./logging";
import { spyPullRequestLookups } from "./pull-request-lookups";
import {
  ROTATED_ACCESS_TOKEN,
  UNUSED_INSTALLATION_DEPS,
  buildFakeAuthDeps,
  buildOverriddenAuthDeps,
  listCallTokens,
  makeFakePullRequestInfo,
  arrangeFakeGate,
} from "./reviewer-github";
import { ACCESS_TOKEN, seedSignIn } from "./sign-in";
import { registerSharedPglite } from "./shared-pglite";

const REPO_ID = 424242;
const REPO = { owner: "octo", repo: "hello" };
const CTX = { installationId: brandInstallationId(BigInt(INSTALLATION_ID)) };
const STACK_PATH = `/api/repos/${REPO_ID}/pulls/${PR_NUMBER}/stack`;
const MERGED_AT = new Date("2026-09-20T09:00:00Z");
const RECORDED_AT = new Date("2026-09-19T12:00:00Z");
const INSIDE_TTL_MS = 9_000;
const PAST_TTL_MS = 11_000;

type GitHubPullState = "open" | "draft" | "closed";

/** A pull request GitHub holds, titled `PR <number>` unless named. */
function arrangePull(
  fake: FakeGitHub,
  prNumber: number,
  refs: { readonly head: string; readonly base: string },
  state: GitHubPullState = "open",
): void {
  const info = {
    ...makeFakePullRequestInfo({ repoId: REPO_ID }),
    title: `PR ${String(prNumber)}`,
    headRef: refs.head,
    baseRef: refs.base,
    headRepo: REPO,
    baseRepo: REPO,
    state: state === "closed" ? "closed" : "open",
    draft: state === "draft",
    merged: state === "closed",
  };
  fake.addPullRequest({ ...REPO, prNumber }, { info });
}

async function seedOpenRow(
  handle: AppDatabase,
  title = "Add thing",
): Promise<PullRequestRow> {
  return createTenantRepository(handle, CTX).pullRequests.upsert({
    repoId: brandRepoId(BigInt(REPO_ID)),
    prNumber: PR_NUMBER,
    repoSlug: REPO_SLUG,
    title,
    state: PrStates.OPEN,
  });
}

async function seedMergedRow(
  handle: AppDatabase,
  title = "Merged thing",
): Promise<PullRequestRow> {
  return createTenantRepository(handle, CTX).pullRequests.upsert({
    repoId: brandRepoId(BigInt(REPO_ID)),
    prNumber: PR_NUMBER,
    repoSlug: REPO_SLUG,
    title,
    state: PrStates.MERGED,
    closedAt: MERGED_AT,
  });
}

async function recordStack(
  handle: AppDatabase,
  row: PullRequestRow,
  stack: unknown,
): Promise<void> {
  const tenant = createTenantRepository(handle, CTX);
  await tenant.pullRequests.recordStack(row.id, {
    stack,
    readAt: RECORDED_AT,
  });
}

async function readRow(handle: AppDatabase): Promise<PullRequestRow> {
  const row = await createTenantRepository(
    handle,
    CTX,
  ).pullRequests.getByNumber(brandRepoId(BigInt(REPO_ID)), PR_NUMBER);
  if (row === undefined) {
    throw new Error("fixture row missing");
  }
  return row;
}

// A forward-only clock offset: octokit's limiter groups are module-global,
// and rewinding the clock under them poisons later calls in the file.
const realNow = Date.now.bind(Date);
let clockOffsetMs = 0;

describe("live stack read", () => {
  const harness = registerSharedPglite();
  let kp: KeyProvider;
  let fake: FakeGitHub;
  let cookie: string;

  beforeEach(async () => {
    vi.spyOn(Date, "now").mockImplementation(() => realNow() + clockOffsetMs);
    kp = createKeyProvider();
    fake = makeFakeGitHub();
    ({ cookie } = await seedSignIn(harness.handle, kp));
    arrangeFakeGate(fake, { repoId: REPO_ID });
  });

  function buildApp(
    auth: AuthDeps = buildFakeAuthDeps(kp, fake),
    logging?: TestLogging,
  ): ApiApp {
    return createApp({
      logger: logging?.logger ?? testLogger(),
      handle: harness.handle,
      webhookSecret: SECRET,
      auth,
      ...UNUSED_INSTALLATION_DEPS,
    });
  }

  async function readStack(app = buildApp()): Promise<Response> {
    return app.request(STACK_PATH, {
      headers: { Cookie: `__Host-mergebrief_session=${cookie}` },
    });
  }

  it("derives the stack from the open list when the PR is in it", async () => {
    await seedOpenRow(harness.handle);
    arrangePull(fake, 6, { head: "feature/base", base: "main" });
    arrangePull(fake, PR_NUMBER, { head: "feature/mid", base: "feature/base" });
    arrangePull(fake, 8, { head: "feature/tip", base: "feature/mid" }, "draft");
    const lookups = spyPullRequestLookups(harness);

    const res = await readStack();

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({
      stack: {
        members: [
          { number: 6, title: "PR 6", state: "open", headRef: "feature/base" },
          {
            number: PR_NUMBER,
            title: `PR ${String(PR_NUMBER)}`,
            state: "open",
            headRef: "feature/mid",
          },
          { number: 8, title: "PR 8", state: "draft", headRef: "feature/tip" },
        ],
        index: 2,
        baseRef: "main",
      },
    });
    expect(fake.listCalls("fetchPullRequest")).toEqual([]);
    expect(lookups.count()).toBe(1);
  });

  it("answers a null stack for a PR with no open neighbours", async () => {
    await seedOpenRow(harness.handle);
    arrangePull(fake, PR_NUMBER, { head: "feature/solo", base: "main" });

    const res = await readStack();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ stack: null });
  });

  it("fetches a PR missing from the open list for its refs", async () => {
    await seedOpenRow(harness.handle, "Fetched");
    arrangePull(fake, PR_NUMBER, { head: "feature/7", base: "main" }, "closed");
    arrangePull(fake, 18, { head: "feature/18", base: "feature/7" });

    const res = await readStack();

    expect(res.status).toBe(200);
    // A closed PR serves its record, which the resolve just became.
    expect(await res.json()).toEqual({
      stack: {
        members: [
          { number: PR_NUMBER, title: `PR ${String(PR_NUMBER)}` },
          { number: 18, title: "PR 18" },
        ],
        index: 1,
      },
      asOf: expect.any(String),
    });
    expect(fake.listCalls("fetchPullRequest")).toHaveLength(1);
  });

  it("decorates a PR the cached open list predates from its own fetch", async () => {
    await seedOpenRow(harness.handle);
    arrangePull(fake, PR_NUMBER, { head: "feature/7", base: "main" }, "closed");
    arrangePull(fake, 18, { head: "feature/18", base: "feature/7" });
    const app = buildApp();
    expect((await readStack(app)).status).toBe(200);

    arrangePull(fake, PR_NUMBER, { head: "feature/7", base: "main" }, "draft");
    clockOffsetMs += INSIDE_TTL_MS;
    const res = await readStack(app);

    expect(await res.json()).toEqual({
      stack: {
        members: [
          {
            number: PR_NUMBER,
            title: `PR ${String(PR_NUMBER)}`,
            state: "draft",
            headRef: "feature/7",
          },
          { number: 18, title: "PR 18", state: "open", headRef: "feature/18" },
        ],
        index: 1,
        baseRef: "main",
      },
    });
    expect(fake.listCalls("listOpenPullRequests")).toHaveLength(1);
  });

  it("re-reads the open list once the cached copy is ten seconds old", async () => {
    await seedOpenRow(harness.handle);
    arrangePull(fake, PR_NUMBER, { head: "feature/mid", base: "main" });
    arrangePull(fake, 8, { head: "feature/tip", base: "feature/mid" });
    const app = buildApp();

    expect((await readStack(app)).status).toBe(200);
    clockOffsetMs += INSIDE_TTL_MS;
    expect((await readStack(app)).status).toBe(200);
    expect(fake.listCalls("listOpenPullRequests")).toHaveLength(1);

    clockOffsetMs += PAST_TTL_MS - INSIDE_TTL_MS;
    expect((await readStack(app)).status).toBe(200);
    expect(fake.listCalls("listOpenPullRequests")).toHaveLength(2);
  });

  it("records a resolved stack on the pull request row", async () => {
    await seedOpenRow(harness.handle);
    arrangePull(fake, PR_NUMBER, { head: "feature/fresh", base: "main" });
    arrangePull(fake, 22, { head: "feature/tip", base: "feature/fresh" });
    const before = Date.now();

    const res = await readStack();

    expect(res.status).toBe(200);
    const row = await readRow(harness.handle);
    expect(row.stack).toEqual({
      members: [
        { number: PR_NUMBER, title: `PR ${String(PR_NUMBER)}` },
        { number: 22, title: "PR 22" },
      ],
      index: 1,
    });
    expect(row.stackReadAt?.getTime()).toBeGreaterThanOrEqual(before);
  });

  it("logs a failed stack record and still answers the resolved stack", async () => {
    await seedOpenRow(harness.handle);
    arrangePull(fake, PR_NUMBER, { head: "feature/mid", base: "main" });
    arrangePull(fake, 8, { head: "feature/tip", base: "feature/mid" });
    const logging = testLogging();
    const auth = buildOverriddenAuthDeps(kp, fake, (client) => ({
      async listOpenPullRequests() {
        await harness.raw("delete from pull_request");
        return client.listOpenPullRequests();
      },
    }));

    const res = await readStack(buildApp(auth, logging));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      stack: {
        members: [
          {
            number: PR_NUMBER,
            title: `PR ${String(PR_NUMBER)}`,
            state: "open",
            headRef: "feature/mid",
          },
          { number: 8, title: "PR 8", state: "open", headRef: "feature/tip" },
        ],
        index: 1,
        baseRef: "main",
      },
    });
    const warned = logging
      .lines()
      .find((line) => line["msg"] === "stack record found no row");
    expect(warned).toMatchObject({ level: "warn" });
  });

  it("a null resolve on an open PR keeps the recorded stack and serves null", async () => {
    const row = await seedOpenRow(harness.handle);
    const recorded = { members: [{ number: PR_NUMBER, title: "x" }], index: 1 };
    await recordStack(harness.handle, row, recorded);
    arrangePull(fake, PR_NUMBER, { head: "feature/solo", base: "main" });

    const res = await readStack();

    expect(await res.json()).toEqual({ stack: null });
    const after = await readRow(harness.handle);
    expect(after.stack).toEqual(recorded);
    expect(after.stackReadAt).toEqual(RECORDED_AT);
  });

  it("serves the recorded stack with its read time for a merged PR", async () => {
    const row = await seedMergedRow(harness.handle);
    const recorded = {
      members: [
        { number: PR_NUMBER, title: "Merged thing" },
        { number: 10, title: "PR 10" },
      ],
      index: 1,
    };
    await recordStack(harness.handle, row, recorded);
    arrangePull(
      fake,
      PR_NUMBER,
      { head: "feature/merged", base: "main" },
      "closed",
    );

    const res = await readStack();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      stack: recorded,
      asOf: RECORDED_AT.toISOString(),
    });
  });

  it("keeps a recorded chain the resolve only shrank by merged ancestors", async () => {
    const row = await seedOpenRow(harness.handle);
    const recorded = {
      members: [
        { number: 6, title: "PR 6" },
        { number: PR_NUMBER, title: `PR ${String(PR_NUMBER)}` },
        { number: 8, title: "PR 8" },
      ],
      index: 2,
    };
    await recordStack(harness.handle, row, recorded);
    arrangePull(fake, PR_NUMBER, { head: "feature/mid", base: "main" });
    arrangePull(fake, 8, { head: "feature/tip", base: "feature/mid" });

    const res = await readStack();

    expect(await res.json()).toEqual({
      stack: {
        members: [
          {
            number: PR_NUMBER,
            title: `PR ${String(PR_NUMBER)}`,
            state: "open",
            headRef: "feature/mid",
          },
          { number: 8, title: "PR 8", state: "open", headRef: "feature/tip" },
        ],
        index: 1,
        baseRef: "main",
      },
    });
    const after = await readRow(harness.handle);
    expect(after.stack).toEqual(recorded);
    expect(after.stackReadAt).toEqual(RECORDED_AT);
  });

  it("a merged PR a child still points at serves the record, not the chain", async () => {
    const row = await seedMergedRow(harness.handle);
    const recorded = {
      members: [
        { number: 6, title: "PR 6" },
        { number: PR_NUMBER, title: `PR ${String(PR_NUMBER)}` },
        { number: 16, title: "PR 16" },
      ],
      index: 2,
    };
    await recordStack(harness.handle, row, recorded);
    arrangePull(fake, PR_NUMBER, { head: "feature/7", base: "main" }, "closed");
    arrangePull(fake, 16, { head: "feature/16", base: "feature/7" });

    const res = await readStack();

    expect(await res.json()).toEqual({
      stack: recorded,
      asOf: RECORDED_AT.toISOString(),
    });
    expect((await readRow(harness.handle)).stackReadAt).toEqual(RECORDED_AT);
  });

  it("a merged PR without a record answers null", async () => {
    await seedMergedRow(harness.handle, "Merged bare");
    arrangePull(fake, PR_NUMBER, { head: "feature/7", base: "main" }, "closed");

    const res = await readStack();

    expect(await res.json()).toEqual({ stack: null });
  });

  it("a record the schema rejects answers null", async () => {
    const row = await seedMergedRow(harness.handle, "Merged bare");
    await recordStack(harness.handle, row, { members: "nope" });
    arrangePull(fake, PR_NUMBER, { head: "feature/7", base: "main" }, "closed");

    const res = await readStack();

    expect(await res.json()).toEqual({ stack: null });
  });

  it("serves the record when GitHub says merged but the row lags open", async () => {
    const row = await seedOpenRow(harness.handle, "Row still open");
    const recorded = {
      members: [
        { number: PR_NUMBER, title: "Row still open" },
        { number: 14, title: "PR 14" },
      ],
      index: 1,
    };
    await recordStack(harness.handle, row, recorded);
    arrangePull(fake, PR_NUMBER, { head: "feature/7", base: "main" }, "closed");

    const res = await readStack();

    expect(await res.json()).toEqual({
      stack: recorded,
      asOf: RECORDED_AT.toISOString(),
    });
  });

  it("keeps the 404 collapse when the list is denied", async () => {
    await seedOpenRow(harness.handle);
    fake.failOn("listOpenPullRequests", FakeFailures.NOT_FOUND);

    const res = await readStack();

    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: "not-found" });
  });

  it("answers 401 when the list still 401s after a good refresh", async () => {
    await seedOpenRow(harness.handle);
    fake.failOn(
      "listOpenPullRequests",
      FakeFailures.UNAUTHORIZED,
      CredentialKinds.REVIEWER,
    );

    const res = await readStack();

    expect(res.status).toBe(401);
    const tokens = listCallTokens(fake.listCalls("listOpenPullRequests"));
    expect(tokens).toEqual([ACCESS_TOKEN, ROTATED_ACCESS_TOKEN]);
  });

  it("surfaces an upstream list failure as 502", async () => {
    await seedOpenRow(harness.handle);
    fake.failOn("listOpenPullRequests", FakeFailures.SERVER_ERROR);

    const res = await readStack();

    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ code: "github-unavailable" });
  });
});
