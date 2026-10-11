// GET /api/repos/:repoId/collaborators over the PGlite harness. The roster
// read reaches the `github/testing` fake through the installation binding;
// the gate's access check answers over `fetch`. A read-only viewer must be
// refused with NO roster read.
import type { RepoCollaborators } from "github";
import {
  CredentialKinds,
  FakeFailures,
  makeFakeGitHub,
  type FakeGitHub,
} from "github/testing";
import type { KeyProvider } from "persistence";
import { createPgliteHarness, type PgliteHarness } from "persistence/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, type ApiApp } from "../src/index";
import { testLogger } from "./logging";
import {
  INSTALLATION_ID,
  REPO_SLUG,
  SECRET,
  brandInstallationId,
  brandReviewerId,
  buildAuthDeps,
  createKeyProvider,
  getRequestUrl,
  answerInstallationRepositories,
} from "./fixtures";
import { spyPullRequestLookups } from "./pull-request-lookups";
import { buildFakeInstallationDeps } from "./reviewer-github";
import { seedSignIn } from "./sign-in";

const REPO_ID = 424242;
const COLLABORATORS_PATH = `/api/repos/${REPO_ID}/collaborators`;

function rosterFixture(): RepoCollaborators {
  return {
    collaborators: [
      {
        login: "alice",
        name: "Alice Example",
        avatarUrl: "https://avatars.example/alice.png",
      },
      { login: "bob", avatarUrl: "https://avatars.example/bob.png" },
    ],
    hasMore: false,
  };
}

function listRosterReads(fake: FakeGitHub) {
  return fake.listCalls("listRepoCollaborators");
}

// ---------------------------------------------------------------------------
// The gate's access check over global fetch; `push` drives the roster guard.
// ---------------------------------------------------------------------------

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      date: new Date().toUTCString(),
    },
  });
}

function repoOk(push: boolean): Response {
  return jsonResponse({
    id: REPO_ID,
    full_name: REPO_SLUG,
    private: true,
    permissions: { push },
  });
}

function stubRepoAccess(
  repositories: (call: number) => Response,
  installationRepos: readonly number[] = [REPO_ID],
): { counts: { repositories: number } } {
  const counts = { repositories: 0 };
  const fetchFn = vi.fn(
    async (input: string | URL | Request): Promise<Response> => {
      const url = getRequestUrl(input);
      const membership = answerInstallationRepositories(url, installationRepos);
      if (membership !== undefined) {
        return membership;
      }
      if (url.includes("/repositories/")) {
        const i = counts.repositories++;
        return repositories(i);
      }
      return jsonResponse({ message: "unexpected endpoint" }, 404);
    },
  );
  vi.stubGlobal("fetch", fetchFn);
  return { counts };
}

async function getCollaborators(
  app: ApiApp,
  cookie: string | undefined,
  path = COLLABORATORS_PATH,
): Promise<Response> {
  return await app.request(path, {
    headers:
      cookie === undefined
        ? {}
        : { cookie: `__Host-mergebrief_session=${cookie}` },
  });
}

describe("GET /api/repos/:repoId/collaborators", () => {
  let harness: PgliteHarness;
  let kp: KeyProvider;
  let fake: FakeGitHub;
  let app: ApiApp;

  beforeEach(async () => {
    harness = await createPgliteHarness();
    kp = createKeyProvider();
    fake = makeFakeGitHub();
    fake.addCollaborators({ owner: "octo", repo: "hello" }, rosterFixture());
    app = createApp({
      logger: testLogger(),
      handle: harness.handle,
      webhookSecret: SECRET,
      auth: buildAuthDeps(kp),
      ...buildFakeInstallationDeps(fake),
    });
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    await harness.close();
  });

  it("401s without a session cookie and never reads the roster", async () => {
    stubRepoAccess(() => repoOk(true));
    const res = await getCollaborators(app, undefined);
    expect(res.status).toBe(401);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(fake.calls).toEqual([]);
  });

  it("404s without repo access and leaves the roster unread", async () => {
    stubRepoAccess(() => jsonResponse({ message: "denied" }, 404));
    const { cookie } = await seedSignIn(harness.handle, kp);
    const res = await getCollaborators(app, cookie);
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(fake.calls).toEqual([]);
  });

  it("404s for a push viewer on a repo outside the installation", async () => {
    stubRepoAccess(() => repoOk(true), []);
    const { cookie } = await seedSignIn(harness.handle, kp);
    const res = await getCollaborators(app, cookie);
    expect(res.status).toBe(404);
    expect(fake.calls).toEqual([]);
  });

  it("404s for a read-only viewer without reading the roster", async () => {
    stubRepoAccess(() => repoOk(false));
    const { cookie } = await seedSignIn(harness.handle, kp);
    const res = await getCollaborators(app, cookie);
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(fake.calls).toEqual([]);
  });

  it("returns the roster with no-store for a push viewer", async () => {
    stubRepoAccess(() => repoOk(true));
    const { cookie } = await seedSignIn(harness.handle, kp);
    const lookups = spyPullRequestLookups(harness);
    const res = await getCollaborators(app, cookie);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-type")).toBe(
      "application/json; charset=utf-8",
    );
    const body: unknown = await res.json();
    expect(body).toEqual(rosterFixture());
    expect(lookups.count()).toBe(0);
    // Read as the App, by the AUTHZ-VERIFIED slug split into owner/repo.
    expect(listRosterReads(fake)).toEqual([
      {
        operation: "listRepoCollaborators",
        credential: {
          kind: CredentialKinds.INSTALLATION,
          installationId: brandInstallationId(BigInt(INSTALLATION_ID)),
        },
        input: { owner: "octo", repo: "hello" },
      },
    ]);
  });

  it("shares the per-repo cache across viewers within the TTL", async () => {
    stubRepoAccess(() => repoOk(true));
    const { cookie } = await seedSignIn(harness.handle, kp);
    const { cookie: otherCookie } = await seedSignIn(harness.handle, kp, {
      reviewer: { id: brandReviewerId(556n), login: "hubot" },
    });
    const first = await getCollaborators(app, cookie);
    // A DIFFERENT push viewer (own session, own gate probe) rides the same
    // roster entry, the point of the installation-token read.
    const second = await getCollaborators(app, otherCookie);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.headers.get("cache-control")).toBe("no-store");
    expect(await second.json()).toEqual(await first.json());
    expect(listRosterReads(fake)).toHaveLength(1);
  });

  it("keeps a warm cache behind the push guard for a read-only viewer", async () => {
    // Gate probes arrive in request order: push viewer first, read-only second.
    stubRepoAccess((call) => repoOk(call === 0));
    const { cookie } = await seedSignIn(harness.handle, kp);
    const { cookie: readOnlyCookie } = await seedSignIn(harness.handle, kp, {
      reviewer: { id: brandReviewerId(557n), login: "lurker" },
    });
    expect((await getCollaborators(app, cookie)).status).toBe(200);
    // The roster is now cached repo-wide. A read-only viewer must still be
    // denied, the guard runs BEFORE the cache lookup, or the shared entry
    // would leak the roster to any read-access viewer.
    const denied = await getCollaborators(app, readOnlyCookie);
    expect(denied.status).toBe(404);
    expect(denied.headers.get("cache-control")).toBe("no-store");
    expect(listRosterReads(fake)).toHaveLength(1);
  });

  it("collapses an App NOT_FOUND to 404", async () => {
    fake.failOn("listRepoCollaborators", FakeFailures.NOT_FOUND);
    stubRepoAccess(() => repoOk(true));
    const { cookie } = await seedSignIn(harness.handle, kp);
    const res = await getCollaborators(app, cookie);
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("502s an upstream failure and caches no failure", async () => {
    fake.failOn("listRepoCollaborators", FakeFailures.SERVER_ERROR);
    stubRepoAccess(() => repoOk(true));
    const { cookie } = await seedSignIn(harness.handle, kp);
    const first = await getCollaborators(app, cookie);
    expect(first.status).toBe(502);
    expect(first.headers.get("cache-control")).toBe("no-store");
    expect((await getCollaborators(app, cookie)).status).toBe(502);
    expect(listRosterReads(fake)).toHaveLength(2);
  });

  it("collapses an App 403 to 404", async () => {
    fake.failOn("listRepoCollaborators", FakeFailures.FORBIDDEN);
    stubRepoAccess(() => repoOk(true));
    const { cookie } = await seedSignIn(harness.handle, kp);
    const res = await getCollaborators(app, cookie);
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: "not-found" });
  });

  it("answers an App 401 as 502, never a sign-in prompt", async () => {
    fake.failOn("listRepoCollaborators", FakeFailures.UNAUTHORIZED);
    stubRepoAccess(() => repoOk(true));
    const { cookie } = await seedSignIn(harness.handle, kp);
    const res = await getCollaborators(app, cookie);
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ code: "github-unavailable" });
  });

  it("traverses exactly ONE authz gate on a cold read", async () => {
    const { counts } = stubRepoAccess(() => repoOk(true));
    const { cookie } = await seedSignIn(harness.handle, kp);
    const res = await getCollaborators(app, cookie);
    expect(res.status).toBe(200);
    expect(counts.repositories).toBe(1);
  });

  it("serves a per-PR read and the roster from one gate entry", async () => {
    const { counts } = stubRepoAccess(() => repoOk(true));
    const { cookie } = await seedSignIn(harness.handle, kp);
    const briefPath = `/api/repos/${REPO_ID}/pulls/7/brief`;

    await getCollaborators(app, cookie, briefPath);
    const res = await getCollaborators(app, cookie);

    expect(res.status).toBe(200);
    expect(counts.repositories).toBe(1);
  });
});
