// The per-repo gate's second rung. A url-box brief is generated behind a
// two-key ladder (reviewer token, then the operator PAT), so a reader whose
// own token GitHub refuses could hold a brief they could not open. The gate
// runs the same ladder, but ONLY for a PR the reader owns in the url-box
// world, so an App-world brief stays governed by the installation alone.
import { createHash, randomBytes } from "node:crypto";
import {
  createArtifactStore,
  createGrantAuth,
  createTenantRepository,
  encryptToken,
  type AppDatabase,
  type KeyProvider,
} from "persistence";
import { PrStates } from "types/pull-requests";
import { createPgliteHarness, type PgliteHarness } from "persistence/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, type ApiApp } from "../src/index";
import { testLogger } from "./logging";
import {
  INSTALLATION_ID,
  KEY_REF,
  PR_NUMBER,
  REPO_SLUG,
  REVIEWER_ID,
  SECRET,
  brandInstallationId,
  brandRepoId,
  brandReviewerId,
  buildAuthDeps,
  buildOperatorToken,
  createKeyProvider,
  listSentTokens,
  SAME_ORIGIN_HEADERS,
} from "./fixtures";

const REPO_ID = 424242;
const ACCESS_TOKEN = "ghu_ACCESS_TOKEN_PLAINTEXT";
const REFRESH_TOKEN = "ghr_REFRESH_TOKEN_PLAINTEXT";
const FALLBACK_PAT = "ghp_OPERATOR_PAT";
const BASE_SHA = "b".repeat(40);
const HEAD_SHA = "a".repeat(40);
const UNKNOWN_SHA = "c".repeat(40);
const DIFF_PATH = `/api/repos/${REPO_ID}/pulls/${PR_NUMBER}/diff`;
const FILE_RANGE_PATH = `/api/repos/${REPO_ID}/pulls/${PR_NUMBER}/file-range`;

const TENANT_CTX = {
  installationId: brandInstallationId(BigInt(INSTALLATION_ID)),
};
const OWNER_CTX = { ownerUserId: brandReviewerId(BigInt(REVIEWER_ID)) };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      date: new Date().toUTCString(),
    },
  });
}

interface RepoCall {
  readonly token: string;
}

/**
 * `GET /repositories/{id}` answers 200 for the operator PAT only, the shape
 * of a repo the App is not installed on: the reviewer's own installation-
 * scoped token cannot see it, the operator's PAT can.
 */
function stubGitHub(): RepoCall[] {
  const calls: RepoCall[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown, init?: RequestInit): Promise<Response> => {
      const url = String(input instanceof Request ? input.url : input);
      const headers = new Headers(
        input instanceof Request ? input.headers : init?.headers,
      );
      const token = (headers.get("authorization") ?? "").replace(
        /^(token|Bearer)\s+/i,
        "",
      );
      if (url.includes("/compare/")) {
        calls.push({ token });
        if (token === FALLBACK_PAT) {
          return new Response("diff --git a/f b/f\n", {
            status: 200,
            headers: {
              "content-type": "application/vnd.github.diff; charset=utf-8",
              date: new Date().toUTCString(),
            },
          });
        }
        return jsonResponse({ message: "Not Found" }, 404);
      }
      const contentsRead = url.includes("/contents/");
      if (contentsRead) {
        if (token === FALLBACK_PAT) {
          return jsonResponse({
            type: "file",
            size: 4,
            sha: "blob-sha",
            content: Buffer.from("a\nb\n").toString("base64"),
            encoding: "base64",
          });
        }
        // The contents read maps a 404 to an absent file, never a denial.
        return jsonResponse({ message: "Forbidden" }, 403);
      }
      if (url.includes("/repositories/")) {
        calls.push({ token });
        if (token === FALLBACK_PAT) {
          return jsonResponse({
            id: REPO_ID,
            full_name: REPO_SLUG,
            private: true,
            permissions: { push: true },
          });
        }
        return jsonResponse({ message: "Not Found" }, 404);
      }
      return jsonResponse({ message: "unexpected endpoint" }, 404);
    }),
  );
  return calls;
}

async function seedSession(
  handle: AppDatabase,
  kp: KeyProvider,
): Promise<string> {
  const cookie = randomBytes(32).toString("base64url");
  const sealedAccess = await encryptToken(kp, KEY_REF, ACCESS_TOKEN);
  const sealedRefresh = await encryptToken(kp, KEY_REF, REFRESH_TOKEN);
  if (!sealedAccess.ok || !sealedRefresh.ok) {
    throw new Error("seed encrypt failed");
  }
  const expiresAt = new Date("2027-01-01T00:00:00Z");
  const grant = await createGrantAuth(handle).createGrant({
    ghTokenCiphertext: sealedAccess.value,
    ghRefreshTokenCiphertext: sealedRefresh.value,
    keyRef: KEY_REF,
    refreshExpiresAt: expiresAt,
  });
  // Installation-bound, like a viewer who signed in through the App: the
  // url-box row they own lives in the OTHER world.
  await createTenantRepository(handle, TENANT_CTX).sessions.create({
    sessionTokenHash: createHash("sha256").update(cookie).digest("hex"),
    reviewerId: brandReviewerId(BigInt(REVIEWER_ID)),
    reviewerLogin: "octocat",
    grantId: grant.id,
    expiresAt,
  });
  return cookie;
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
  const written = await createArtifactStore(handle, OWNER_CTX).briefs.write({
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
  if (!written.ok) {
    throw new Error("brief seed failed");
  }
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

  beforeEach(async () => {
    harness = await createPgliteHarness();
    kp = createKeyProvider();
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await harness.close();
  });

  function buildApp(
    fallbackToken?: string,
    listedReviewerIds: readonly number[] = [REVIEWER_ID],
  ): ApiApp {
    return createApp({
      logger: testLogger(),
      handle: harness.handle,
      webhookSecret: SECRET,
      auth: buildAuthDeps(kp),
      github: {
        fetchPullRequestConversation: async () => {
          throw new Error("conversation port must not be called");
        },
        listRepoCollaborators: async () => {
          throw new Error("collaborators port must not be called");
        },
        commitAttachment: async () => {
          throw new Error("attachment port must not be called in this suite");
        },
        deleteAttachmentBranch: async () => {
          throw new Error("attachment port must not be called in this suite");
        },
      },
      operatorToken:
        fallbackToken === undefined
          ? undefined
          : buildOperatorToken(fallbackToken, listedReviewerIds),
    });
  }

  async function read(app: ApiApp, cookie: string): Promise<Response> {
    return app.request(`/api/repos/${REPO_ID}/pulls/${PR_NUMBER}`, {
      headers: { Cookie: `__Host-mergebrief_session=${cookie}` },
    });
  }

  it("opens a url-box brief the reader owns when their own token is refused", async () => {
    const calls = stubGitHub();
    const cookie = await seedSession(harness.handle, kp);
    await seedOwnerPullRequest(harness.handle);

    const res = await read(buildApp(FALLBACK_PAT), cookie);

    expect(res.status).toBe(200);
    expect(calls.map((call) => call.token)).toEqual([
      ACCESS_TOKEN,
      FALLBACK_PAT,
    ]);
  });

  it("keeps write affordances off, the PAT's push right is not the reader's", async () => {
    stubGitHub();
    const cookie = await seedSession(harness.handle, kp);
    await seedOwnerPullRequest(harness.handle);

    const res = await read(buildApp(FALLBACK_PAT), cookie);
    const body: unknown = await res.json();

    expect(res.status).toBe(200);
    // The stub grants push on the PAT read; the reader still gets none.
    expect(body).toMatchObject({ viewerCanResolve: false });
  });

  it("404s with no operator PAT configured", async () => {
    stubGitHub();
    const cookie = await seedSession(harness.handle, kp);
    await seedOwnerPullRequest(harness.handle);

    const res = await read(buildApp(), cookie);

    expect(res.status).toBe(404);
  });

  it("404s a reader who is not on the operator list", async () => {
    stubGitHub();
    const cookie = await seedSession(harness.handle, kp);
    await seedOwnerPullRequest(harness.handle);

    const unlisted = await read(
      buildApp(FALLBACK_PAT, [REVIEWER_ID + 1]),
      cookie,
    );
    const sentTokens = listSentTokens();
    const unconfigured = await read(buildApp(), cookie);

    expect(unlisted.status).toBe(404);
    expect(sentTokens).toEqual([ACCESS_TOKEN]);
    expect(unlisted.status).toBe(unconfigured.status);
    expect(await unlisted.json()).toEqual(await unconfigured.json());
  });

  it("never widens an App-world brief, no owned url-box row, no second rung", async () => {
    const calls = stubGitHub();
    const cookie = await seedSession(harness.handle, kp);
    await seedTenantPullRequest(harness.handle);

    const res = await read(buildApp(FALLBACK_PAT), cookie);

    expect(res.status).toBe(404);
    expect(calls.map((call) => call.token)).toEqual([ACCESS_TOKEN]);
  });

  // The shape the narrowing exists for: the installation already tracks this
  // PR (webhook-ingested), and the reader, whom GitHub refuses for this
  // repo, pasted its URL. The PAT opens the gate, but the tenant's own rows
  // must stay out of reach: they read THEIR paste, never the installation's.
  it("serves the reader's own url-box row over the installation's", async () => {
    stubGitHub();
    const cookie = await seedSession(harness.handle, kp);
    await seedTenantPullRequest(harness.handle, "the installation's row");
    await seedOwnerPullRequest(harness.handle, "the reader's own paste");

    const res = await read(buildApp(FALLBACK_PAT), cookie);
    const body: unknown = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ title: "the reader's own paste" });
  });

  // Url-box rows are instance-visible to a reader who proved GitHub access to
  // the repo. This reader proved nothing, the operator's key did, so the
  // widening must stop here, or the PAT becomes a read-anything key.
  it("does not open ANOTHER user's url-box row on the PAT rung", async () => {
    stubGitHub();
    const cookie = await seedSession(harness.handle, kp);
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
    const calls = stubGitHub();
    const cookie = await seedSession(harness.handle, kp);
    await seedTenantPullRequest(harness.handle, "the installation's row");
    await seedOwnerPullRequest(harness.handle, "the reader's own paste");
    const app = buildApp(FALLBACK_PAT);

    await read(app, cookie);
    const second = await read(app, cookie);
    const body: unknown = await second.json();

    expect(second.status).toBe(200);
    expect(body).toMatchObject({ title: "the reader's own paste" });
    // Cached: the second read spent no GitHub call at all.
    expect(calls.map((call) => call.token)).toEqual([
      ACCESS_TOKEN,
      FALLBACK_PAT,
    ]);
  });

  // The rung proves nothing about any installation, so the ledger files the
  // write in the owner world the gate resolved.
  it("audits a write behind the rung under the owner world", async () => {
    stubGitHub();
    const cookie = await seedSession(harness.handle, kp);
    await seedOwnerPullRequest(harness.handle);
    const app = buildApp(FALLBACK_PAT);

    // A private write behind the same gate, a read is never audited.
    const res = await app.request(
      `/api/repos/${REPO_ID}/pulls/${PR_NUMBER}/session/chunks/c1/read?base=${"b".repeat(40)}&head=${"a".repeat(40)}`,
      {
        method: "PUT",
        headers: {
          ...SAME_ORIGIN_HEADERS,
          Cookie: `__Host-mergebrief_session=${cookie}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ read: true }),
      },
    );

    // No brief in the reader's own world, so the write itself finds nothing.
    expect(res.status).toBe(404);
    const rows = await harness.raw(
      "select operation, installation_id, source from audit_log order by id",
    );
    expect(rows).toEqual([
      {
        operation: "set-chunk-read",
        installation_id: null,
        source: "url",
      },
    ]);
  });

  // The positive cache is keyed per REPO, but the rung was granted for one
  // PR. A warm entry must not carry a second, unrelated PR of the same repo
  // past a gate that never checked it.
  it("does not let one PAT-carried pass clear the gate for another PR", async () => {
    const calls = stubGitHub();
    const cookie = await seedSession(harness.handle, kp);
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
    expect(calls.map((call) => call.token)).toEqual([
      ACCESS_TOKEN,
      FALLBACK_PAT,
      ACCESS_TOKEN,
    ]);
  });

  // The gate is not the only door to GitHub: a read route that fetches live
  // (the span diff, the conversation) has to reach it the same way, or the
  // page opens onto empty panes.
  it("fetches the span diff on the same rung that opened the gate", async () => {
    const calls = stubGitHub();
    const cookie = await seedSession(harness.handle, kp);
    await seedOwnerBrief(harness.handle);

    const res = await buildApp(FALLBACK_PAT).request(
      `${DIFF_PATH}?base=${BASE_SHA}&head=${HEAD_SHA}`,
      { headers: { Cookie: `__Host-mergebrief_session=${cookie}` } },
    );

    expect(res.status).toBe(200);
    expect(await res.text()).toContain("diff --git");
    // Gate: reader then PAT. Diff: reader denied, then PAT.
    expect(calls.map((call) => call.token)).toEqual([
      ACCESS_TOKEN,
      FALLBACK_PAT,
      ACCESS_TOKEN,
      FALLBACK_PAT,
    ]);
  });

  it("leaves the diff refused when no operator PAT is configured", async () => {
    stubGitHub();
    const cookie = await seedSession(harness.handle, kp);
    await seedOwnerPullRequest(harness.handle);

    const res = await buildApp().request(
      `/api/repos/${REPO_ID}/pulls/${PR_NUMBER}/diff?base=${"b".repeat(40)}&head=${"a".repeat(40)}`,
      { headers: { Cookie: `__Host-mergebrief_session=${cookie}` } },
    );

    expect(res.status).toBe(404);
  });

  // The operator's key reads the whole repository; the reader is owed only
  // the commits recorded for the pull request they pasted.
  it("a diff at an unknown head 404s without an operator compare", async () => {
    stubGitHub();
    const cookie = await seedSession(harness.handle, kp);
    await seedOwnerBrief(harness.handle);

    const res = await buildApp(FALLBACK_PAT).request(
      `${DIFF_PATH}?base=${BASE_SHA}&head=${UNKNOWN_SHA}`,
      { headers: { Cookie: `__Host-mergebrief_session=${cookie}` } },
    );

    expect(res.status).toBe(404);
    // Gate: reader then PAT. Diff: the reader's own token and nothing after.
    expect(listSentTokens()).toEqual([
      ACCESS_TOKEN,
      FALLBACK_PAT,
      ACCESS_TOKEN,
    ]);
  });

  it("a diff at a branch name 404s without an operator compare", async () => {
    stubGitHub();
    const cookie = await seedSession(harness.handle, kp);
    await seedOwnerBrief(harness.handle);

    const res = await buildApp(FALLBACK_PAT).request(
      `${DIFF_PATH}?base=${BASE_SHA}&head=main`,
      { headers: { Cookie: `__Host-mergebrief_session=${cookie}` } },
    );

    expect(res.status).toBe(404);
    expect(listSentTokens()).toEqual([
      ACCESS_TOKEN,
      FALLBACK_PAT,
      ACCESS_TOKEN,
    ]);
  });

  it("reads a file at a known commit on the operator token", async () => {
    stubGitHub();
    const cookie = await seedSession(harness.handle, kp);
    await seedOwnerBrief(harness.handle);

    const res = await buildApp(FALLBACK_PAT).request(
      `${FILE_RANGE_PATH}?ref=${HEAD_SHA}&path=src/app.ts&from=1&to=2`,
      { headers: { Cookie: `__Host-mergebrief_session=${cookie}` } },
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ lines: ["a", "b"] });
    expect(listSentTokens()).toEqual([
      ACCESS_TOKEN,
      FALLBACK_PAT,
      ACCESS_TOKEN,
      FALLBACK_PAT,
    ]);
  });

  it("reads no file at an unknown commit on the operator token", async () => {
    stubGitHub();
    const cookie = await seedSession(harness.handle, kp);
    await seedOwnerBrief(harness.handle);

    const res = await buildApp(FALLBACK_PAT).request(
      `${FILE_RANGE_PATH}?ref=${UNKNOWN_SHA}&path=src/app.ts&from=1&to=2`,
      { headers: { Cookie: `__Host-mergebrief_session=${cookie}` } },
    );

    expect(res.status).toBe(404);
    expect(listSentTokens()).toEqual([
      ACCESS_TOKEN,
      FALLBACK_PAT,
      ACCESS_TOKEN,
    ]);
  });

  // The write still cannot happen, posting under the operator's token would
  // put the reader's words on GitHub as the operator. What changes is the
  // refusal: the uniform 404 reads as "this pull request is gone", which
  // sends a reader hunting for something that is fine. The gate already
  // showed them the brief, so there is no existence left to protect.
  it("refuses a write honestly instead of claiming the PR is gone", async () => {
    stubGitHub();
    const cookie = await seedSession(harness.handle, kp);
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
    stubGitHub();
    const cookie = await seedSession(harness.handle, kp);
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
