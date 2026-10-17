// The per-repo gate's second rung. A url-box brief is generated behind a
// two-key ladder (reviewer token, then the operator PAT), so a reader whose
// own token GitHub refuses could hold a brief they could not open. The gate
// runs the same ladder, but ONLY for a PR the reader owns in the url-box
// world, so an App-world brief stays governed by the installation alone.
import { RepoFileKinds } from "github";
import {
  CredentialKinds,
  FakeFactsHidings,
  FakeFailures,
  makeFakeGitHub,
  type FakeFailure,
  type FakeGitHub,
} from "github/testing";
import {
  createArtifactStore,
  createTenantRepository,
  type AppDatabase,
  type KeyProvider,
  type PullRequestRow,
} from "persistence";
import { PrStates } from "types/pull-requests";
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
  buildOperatorToken,
  createKeyProvider,
  SAME_ORIGIN_HEADERS,
} from "./fixtures";
import {
  DENIED_GATE_CALLS,
  OPERATOR_GATE_CALLS,
  UNUSED_INSTALLATION_DEPS,
  arrangeFakeGate,
  arrangeFakePullRequest,
  buildFakeAuthDeps,
  listCallTokens,
  listCallsPastGate,
} from "./reviewer-github";
import { spyPullRequestLookups } from "./pull-request-lookups";
import { ACCESS_TOKEN, seedSignIn } from "./sign-in";

const REPO_ID = 424242;
const FALLBACK_PAT = "ghp_OPERATOR_PAT";
const BASE_SHA = "b".repeat(40);
const HEAD_SHA = "a".repeat(40);
const UNKNOWN_SHA = "c".repeat(40);
const DIFF_PATH = `/api/repos/${REPO_ID}/pulls/${PR_NUMBER}/diff`;
const FILE_RANGE_PATH = `/api/repos/${REPO_ID}/pulls/${PR_NUMBER}/file-range`;
const STACK_PATH = `/api/repos/${REPO_ID}/pulls/${PR_NUMBER}/stack`;
const REPO = { owner: "octo", repo: "hello" };
const DIFF_TEXT = "diff --git a/f b/f\n";
const FILE_PATH = "src/app.ts";

const TENANT_CTX = {
  installationId: brandInstallationId(BigInt(INSTALLATION_ID)),
};
const OWNER_CTX = { ownerUserId: brandReviewerId(BigInt(REVIEWER_ID)) };

/**
 * The repo refuses the viewer's token and reads on any other, the shape of a
 * repo the App is not installed on: the reviewer's own installation-scoped
 * token cannot see it, the operator's PAT can.
 */
function arrangeOperatorGate(fake: FakeGitHub): void {
  arrangeFakeGate(fake, { repoId: REPO_ID, viewerStatus: 404 });
}

/** The token each gate repository read carried, the rung's included. */
function listGateTokens(fake: FakeGitHub): string[] {
  return listCallTokens(fake.listCalls("fetchRepositoryById"));
}

/** The token each call after an operator-footed gate pass carried. */
function listTokensPastOperatorGate(fake: FakeGitHub): string[] {
  return listCallTokens(listCallsPastGate(fake, OPERATOR_GATE_CALLS));
}

async function seedOwnerPullRequest(
  handle: AppDatabase,
  title = "the reader's own paste",
): Promise<void> {
  await createTenantRepository(handle, OWNER_CTX).pullRequests.upsert({
    repoId: brandRepoId(BigInt(REPO_ID)),
    prNumber: PR_NUMBER,
    repoSlug: REPO_SLUG,
    state: PrStates.OPEN,
    title,
  });
}

/** The reader's paste with the commits a generated Brief records for it. */
async function seedOwnerBrief(handle: AppDatabase): Promise<void> {
  const repoId = brandRepoId(BigInt(REPO_ID));
  const pr = await createTenantRepository(
    handle,
    OWNER_CTX,
  ).pullRequests.upsert({
    repoId,
    prNumber: PR_NUMBER,
    repoSlug: REPO_SLUG,
    state: PrStates.OPEN,
    title: "the reader's own paste",
    baseSha: BASE_SHA,
    liveRead: { readAt: new Date(), headSha: HEAD_SHA },
  });
  await createArtifactStore(handle, OWNER_CTX).briefs.write({
    pullRequestId: pr.id,
    baseSha: BASE_SHA,
    headSha: HEAD_SHA,
    headIndex: 1,
    commitCount: 1,
    provider: "p",
    model: "m",
    effort: "e",
    body: "{}",
  });
}

async function seedTenantPullRequest(
  handle: AppDatabase,
  title = "the installation's row",
): Promise<void> {
  await createTenantRepository(handle, TENANT_CTX).pullRequests.upsert({
    repoId: brandRepoId(BigInt(REPO_ID)),
    prNumber: PR_NUMBER,
    repoSlug: REPO_SLUG,
    state: PrStates.OPEN,
    title,
  });
}

describe("the per-repo gate's operator-PAT rung", () => {
  let harness: PgliteHarness;
  let kp: KeyProvider;
  let fake: FakeGitHub;

  beforeEach(async () => {
    harness = await createPgliteHarness();
    kp = createKeyProvider();
    fake = makeFakeGitHub();
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await harness.close();
  });

  function buildApp(
    fallbackToken?: string,
    tokenOwnerId: number = REVIEWER_ID,
  ): ApiApp {
    return createApp({
      logger: testLogger(),
      handle: harness.handle,
      webhookSecret: SECRET,
      auth: buildFakeAuthDeps(kp, fake),
      ...UNUSED_INSTALLATION_DEPS,
      operatorToken:
        fallbackToken === undefined
          ? undefined
          : buildOperatorToken(fallbackToken, tokenOwnerId),
    });
  }

  async function signIn(): Promise<string> {
    const { cookie } = await seedSignIn(harness.handle, kp);
    return cookie;
  }

  async function readOwnerRow(): Promise<PullRequestRow | undefined> {
    return createTenantRepository(
      harness.handle,
      OWNER_CTX,
    ).pullRequests.getByNumber(brandRepoId(BigInt(REPO_ID)), PR_NUMBER);
  }

  async function read(app: ApiApp, cookie: string): Promise<Response> {
    return app.request(`/api/repos/${REPO_ID}/pulls/${PR_NUMBER}`, {
      headers: { Cookie: `__Host-mergebrief_session=${cookie}` },
    });
  }

  it("opens a url-box brief the reader owns when their own token is refused", async () => {
    arrangeOperatorGate(fake);
    const cookie = await signIn();
    await seedOwnerPullRequest(harness.handle);

    const res = await read(buildApp(FALLBACK_PAT), cookie);

    expect(res.status).toBe(200);
    expect(listGateTokens(fake)).toEqual([ACCESS_TOKEN, FALLBACK_PAT]);
  });

  it("keeps write affordances off, the PAT's push right is not the reader's", async () => {
    arrangeOperatorGate(fake);
    const cookie = await signIn();
    await seedOwnerPullRequest(harness.handle);

    const res = await read(buildApp(FALLBACK_PAT), cookie);
    const body: unknown = await res.json();

    expect(res.status).toBe(200);
    // The stub grants push on the PAT read; the reader still gets none.
    expect(body).toMatchObject({ viewerCanResolve: false });
  });

  it("404s with no operator PAT configured", async () => {
    arrangeOperatorGate(fake);
    const cookie = await signIn();
    await seedOwnerPullRequest(harness.handle);

    const res = await read(buildApp(), cookie);

    expect(res.status).toBe(404);
  });

  it("404s a reader who does not own the operator token", async () => {
    arrangeOperatorGate(fake);
    const cookie = await signIn();
    await seedOwnerPullRequest(harness.handle);

    const nonOwner = await read(
      buildApp(FALLBACK_PAT, REVIEWER_ID + 1),
      cookie,
    );
    const sentTokens = listGateTokens(fake);
    const unconfigured = await read(buildApp(), cookie);

    expect(nonOwner.status).toBe(404);
    expect(sentTokens).toEqual([ACCESS_TOKEN]);
    expect(nonOwner.status).toBe(unconfigured.status);
    expect(await nonOwner.json()).toEqual(await unconfigured.json());
  });

  it("never widens an App-world brief, no owned url-box row, no second rung", async () => {
    arrangeOperatorGate(fake);
    const cookie = await signIn();
    await seedTenantPullRequest(harness.handle);

    const res = await read(buildApp(FALLBACK_PAT), cookie);

    expect(res.status).toBe(404);
    expect(listGateTokens(fake)).toEqual([ACCESS_TOKEN]);
  });

  // The shape the narrowing exists for: the installation already tracks this
  // PR (webhook-ingested), and the reader, whom GitHub refuses for this
  // repo, pasted its URL. The PAT opens the gate, but the tenant's own rows
  // must stay out of reach: they read THEIR paste, never the installation's.
  it("serves the reader's own url-box row over the installation's", async () => {
    arrangeOperatorGate(fake);
    const cookie = await signIn();
    await seedTenantPullRequest(harness.handle, "the installation's row");
    await seedOwnerPullRequest(harness.handle, "the reader's own paste");

    const res = await read(buildApp(FALLBACK_PAT), cookie);
    const body: unknown = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ title: "the reader's own paste" });
  });

  // The live read on the operator footing asks the viewer's token first and
  // the operator's reader only for what the viewer could not see.
  it("reads live facts the viewer was not shown on the operator token", async () => {
    arrangeOperatorGate(fake);
    const cookie = await signIn();
    await seedOwnerPullRequest(harness.handle);
    arrangeFakePullRequest(fake, { repoId: REPO_ID });
    const ref = { owner: "octo", repo: "hello", prNumber: PR_NUMBER };
    fake.hideFacts(ref, CredentialKinds.REVIEWER, FakeFactsHidings.NOT_SHOWN);

    const res = await read(buildApp(FALLBACK_PAT), cookie);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ title: "A pull request" });
    expect(listTokensPastOperatorGate(fake)).toEqual([
      ACCESS_TOKEN,
      FALLBACK_PAT,
    ]);
    expect((await readOwnerRow())?.githubUnreachableAt).toBeNull();
  });

  it("never marks a row the viewer was refused on the operator's word", async () => {
    arrangeOperatorGate(fake);
    const cookie = await signIn();
    await seedOwnerPullRequest(harness.handle);
    const ref = { owner: "octo", repo: "hello", prNumber: PR_NUMBER };
    fake.hideFacts(ref, CredentialKinds.REVIEWER, FakeFactsHidings.WITHHELD);

    const res = await read(buildApp(FALLBACK_PAT), cookie);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ title: "the reader's own paste" });
    expect(listTokensPastOperatorGate(fake)).toEqual([
      ACCESS_TOKEN,
      FALLBACK_PAT,
    ]);
    const row = await readOwnerRow();
    expect(row?.githubReadAt).not.toBeNull();
    expect(row?.githubUnreachableAt).toBeNull();
  });

  // Url-box rows are instance-visible to a reader who proved GitHub access to
  // the repo. This reader proved nothing, the operator's key did, so the
  // widening must stop here, or the PAT becomes a read-anything key.
  it("does not open ANOTHER user's url-box row on the PAT rung", async () => {
    arrangeOperatorGate(fake);
    const cookie = await signIn();
    await createTenantRepository(harness.handle, {
      ownerUserId: brandReviewerId(BigInt(REVIEWER_ID + 1)),
    }).pullRequests.upsert({
      repoId: brandRepoId(BigInt(REPO_ID)),
      prNumber: PR_NUMBER,
      repoSlug: REPO_SLUG,
      state: PrStates.OPEN,
      title: "somebody else's paste",
    });

    const res = await read(buildApp(FALLBACK_PAT), cookie);

    expect(res.status).toBe(404);
  });

  // The positive cache stores the PAT-carried pass for 60s. A second request
  // inside that window skips GitHub entirely, and must still land in the
  // reader's own world, or the leak returns one request later.
  it("keeps the reader pinned to their own world on a cached second read", async () => {
    arrangeOperatorGate(fake);
    const cookie = await signIn();
    await seedTenantPullRequest(harness.handle, "the installation's row");
    await seedOwnerPullRequest(harness.handle, "the reader's own paste");
    const app = buildApp(FALLBACK_PAT);

    await read(app, cookie);
    const second = await read(app, cookie);
    const body: unknown = await second.json();

    expect(second.status).toBe(200);
    expect(body).toMatchObject({ title: "the reader's own paste" });
    // Cached: the second read spent no GitHub call at all.
    expect(listGateTokens(fake)).toEqual([ACCESS_TOKEN, FALLBACK_PAT]);
  });

  // The rung proves nothing about any installation, so the ledger files the
  // write in the owner world the gate resolved.
  it("audits a write behind the rung under the owner world", async () => {
    arrangeOperatorGate(fake);
    const cookie = await signIn();
    await seedOwnerPullRequest(harness.handle);
    const app = buildApp(FALLBACK_PAT);

    // A private write behind the same gate, a read is never audited.
    const res = await app.request(
      `/api/repos/${REPO_ID}/pulls/${PR_NUMBER}/session/chunks/c1/read?base=${"b".repeat(40)}&head=${"a".repeat(40)}`,
      {
        method: "POST",
        headers: {
          ...SAME_ORIGIN_HEADERS,
          Cookie: `__Host-mergebrief_session=${cookie}`,
        },
      },
    );

    // No brief in the reader's own world, so the write itself finds nothing.
    expect(res.status).toBe(404);
    const rows = await harness.raw(
      "select operation, installation_id, source from audit_log order by id",
    );
    expect(rows).toEqual([
      {
        operation: "mark-chunk-read",
        installation_id: null,
        source: "url",
      },
    ]);
  });

  // The positive cache is keyed per REPO, but the rung was granted for one
  // PR. A warm entry must not carry a second, unrelated PR of the same repo
  // past a gate that never checked it.
  it("does not let one PAT-carried pass clear the gate for another PR", async () => {
    arrangeOperatorGate(fake);
    const cookie = await signIn();
    await seedOwnerPullRequest(harness.handle);
    const app = buildApp(FALLBACK_PAT);

    await read(app, cookie);
    const other = await app.request(
      `/api/repos/${REPO_ID}/pulls/${PR_NUMBER + 5}`,
      {
        headers: { Cookie: `__Host-mergebrief_session=${cookie}` },
      },
    );

    expect(other.status).toBe(404);
    // The warm entry was refused, so the second request re-ran the ladder:
    // the reader's token, then no owned row for those coordinates.
    expect(listGateTokens(fake)).toEqual([
      ACCESS_TOKEN,
      FALLBACK_PAT,
      ACCESS_TOKEN,
    ]);
  });

  // The gate is not the only door to GitHub: a live read behind an operator
  // pass reaches the operator token through the binding, and only at commits
  // recorded for the granted PR.
  describe("live reads behind an operator pass", () => {
    async function getLive(app: ApiApp, path: string): Promise<Response> {
      const cookie = await signIn();
      return app.request(path, {
        headers: { Cookie: `__Host-mergebrief_session=${cookie}` },
      });
    }

    function arrangeViewerRefusedDiff(head: string): void {
      fake.addCompare(REPO, { base: BASE_SHA, head }, { diff: DIFF_TEXT });
      fake.failOn(
        "fetchCompareDiff",
        FakeFailures.NOT_FOUND,
        CredentialKinds.REVIEWER,
      );
    }

    function arrangeViewerRefusedFile(
      ref: string,
      failure: FakeFailure = FakeFailures.FORBIDDEN,
    ): void {
      fake.addRepoFile(
        REPO,
        { path: FILE_PATH, ref },
        { kind: RepoFileKinds.FILE, content: "a\nb\n", blobSha: "b", size: 4 },
      );
      fake.failOn("fetchRepoFile", failure, CredentialKinds.REVIEWER);
    }

    it("fetches the span diff on the same rung that opened the gate", async () => {
      arrangeOperatorGate(fake);
      await seedOwnerBrief(harness.handle);
      arrangeViewerRefusedDiff(HEAD_SHA);
      const lookups = spyPullRequestLookups(harness);

      const res = await getLive(
        buildApp(FALLBACK_PAT),
        `${DIFF_PATH}?base=${BASE_SHA}&head=${HEAD_SHA}`,
      );

      expect(res.status).toBe(200);
      expect(await res.text()).toBe(DIFF_TEXT);
      expect(listGateTokens(fake)).toEqual([ACCESS_TOKEN, FALLBACK_PAT]);
      expect(listTokensPastOperatorGate(fake)).toEqual([
        ACCESS_TOKEN,
        FALLBACK_PAT,
      ]);
      // The gate rung probes the reader's own url row once, then the row loads.
      expect(lookups.count()).toBe(2);
    });

    it("leaves the diff refused when no operator PAT is configured", async () => {
      arrangeOperatorGate(fake);
      await seedOwnerBrief(harness.handle);
      arrangeViewerRefusedDiff(HEAD_SHA);

      const res = await getLive(
        buildApp(),
        `${DIFF_PATH}?base=${BASE_SHA}&head=${HEAD_SHA}`,
      );

      expect(res.status).toBe(404);
      expect(listCallsPastGate(fake, DENIED_GATE_CALLS)).toEqual([]);
    });

    const unknownHeads = [
      ["an unknown head", UNKNOWN_SHA],
      ["a branch name", "main"],
      ["a short SHA", HEAD_SHA.slice(0, 7)],
    ] as const;

    it.each(unknownHeads)(
      "a diff at %s 404s without an operator compare",
      async (_label, head) => {
        arrangeOperatorGate(fake);
        await seedOwnerBrief(harness.handle);
        arrangeViewerRefusedDiff(head);

        const res = await getLive(
          buildApp(FALLBACK_PAT),
          `${DIFF_PATH}?base=${BASE_SHA}&head=${head}`,
        );

        expect(res.status).toBe(404);
        expect(listGateTokens(fake)).toEqual([ACCESS_TOKEN, FALLBACK_PAT]);
        expect(listTokensPastOperatorGate(fake)).toEqual([ACCESS_TOKEN]);
      },
    );

    it("a diff missing its head 400s with no GitHub call", async () => {
      arrangeOperatorGate(fake);
      await seedOwnerBrief(harness.handle);
      arrangeViewerRefusedDiff(HEAD_SHA);

      const res = await getLive(
        buildApp(FALLBACK_PAT),
        `${DIFF_PATH}?base=${BASE_SHA}`,
      );

      expect(res.status).toBe(400);
      expect(listCallsPastGate(fake, OPERATOR_GATE_CALLS)).toEqual([]);
    });

    const viewerFileRefusals = [
      ["a 403", FakeFailures.FORBIDDEN],
      ["a 404", FakeFailures.NOT_FOUND],
    ] as const;

    it.each(viewerFileRefusals)(
      "reads a file the viewer got %s for on the operator token",
      async (_label, failure) => {
        arrangeOperatorGate(fake);
        await seedOwnerBrief(harness.handle);
        arrangeViewerRefusedFile(HEAD_SHA, failure);

        const res = await getLive(
          buildApp(FALLBACK_PAT),
          `${FILE_RANGE_PATH}?ref=${HEAD_SHA}&path=${FILE_PATH}&from=1&to=2`,
        );

        expect(res.status).toBe(200);
        expect(await res.json()).toMatchObject({ lines: ["a", "b"] });
        expect(listGateTokens(fake)).toEqual([ACCESS_TOKEN, FALLBACK_PAT]);
        expect(listTokensPastOperatorGate(fake)).toEqual([
          ACCESS_TOKEN,
          FALLBACK_PAT,
        ]);
      },
    );

    it("reads no file at an unknown commit on the operator token", async () => {
      arrangeOperatorGate(fake);
      await seedOwnerBrief(harness.handle);
      arrangeViewerRefusedFile(UNKNOWN_SHA);

      const res = await getLive(
        buildApp(FALLBACK_PAT),
        `${FILE_RANGE_PATH}?ref=${UNKNOWN_SHA}&path=${FILE_PATH}&from=1&to=2`,
      );

      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ code: "not-found" });
      expect(listGateTokens(fake)).toEqual([ACCESS_TOKEN, FALLBACK_PAT]);
      expect(listTokensPastOperatorGate(fake)).toEqual([ACCESS_TOKEN]);
    });

    const refusedRefs = [
      ["a missing ref", ""],
      ["a branch name", "&ref=main"],
      ["a short SHA", `&ref=${HEAD_SHA.slice(0, 7)}`],
    ] as const;

    it.each(refusedRefs)(
      "a file range at %s 400s with no GitHub call",
      async (_label, ref) => {
        arrangeOperatorGate(fake);
        await seedOwnerBrief(harness.handle);
        arrangeViewerRefusedFile(HEAD_SHA);

        const res = await getLive(
          buildApp(FALLBACK_PAT),
          `${FILE_RANGE_PATH}?path=${FILE_PATH}&from=1&to=2${ref}`,
        );

        expect(res.status).toBe(400);
        expect(listGateTokens(fake)).toEqual([ACCESS_TOKEN, FALLBACK_PAT]);
        expect(listCallsPastGate(fake, OPERATOR_GATE_CALLS)).toEqual([]);
      },
    );

    it("serves no stack on the operator token and lists no open PRs", async () => {
      arrangeOperatorGate(fake);
      await seedOwnerPullRequest(harness.handle);
      arrangeFakePullRequest(fake, { repoId: REPO_ID });
      arrangeFakePullRequest(fake, {
        repoId: REPO_ID,
        prNumber: PR_NUMBER + 1,
      });

      const res = await getLive(buildApp(FALLBACK_PAT), STACK_PATH);

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ stack: null });
      // Gate: reader then PAT. Stack: nothing, the repo's open list is not owed.
      expect(listGateTokens(fake)).toEqual([ACCESS_TOKEN, FALLBACK_PAT]);
      expect(listCallsPastGate(fake, OPERATOR_GATE_CALLS)).toEqual([]);
    });
  });

  it("refuses a write honestly instead of claiming the PR is gone", async () => {
    arrangeOperatorGate(fake);
    const cookie = await signIn();
    await seedOwnerPullRequest(harness.handle);

    const res = await buildApp(FALLBACK_PAT).request(
      `/api/repos/${REPO_ID}/pulls/${PR_NUMBER}/ready`,
      {
        method: "POST",
        headers: {
          ...SAME_ORIGIN_HEADERS,
          Cookie: `__Host-mergebrief_session=${cookie}`,
          "content-type": "application/json",
        },
        body: "{}",
      },
    );

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "no-repo-write-access" });
  });

  it("keeps the uniform 404 for a write the gate never PAT-passed", async () => {
    arrangeOperatorGate(fake);
    const cookie = await signIn();
    await seedTenantPullRequest(harness.handle);

    const res = await buildApp(FALLBACK_PAT).request(
      `/api/repos/${REPO_ID}/pulls/${PR_NUMBER}/ready`,
      {
        method: "POST",
        headers: {
          ...SAME_ORIGIN_HEADERS,
          Cookie: `__Host-mergebrief_session=${cookie}`,
          "content-type": "application/json",
        },
        body: "{}",
      },
    );

    expect(res.status).toBe(404);
  });
});
