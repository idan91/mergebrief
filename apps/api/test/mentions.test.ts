// GET /api/repos/:repoId/mention-suggestions and /mention-targets over
// PGlite: the reads reach the `github/testing` fake on the viewer's own
// binding, so a read-only viewer gets what GitHub shows them and nobody else.
import { MentionBounds } from "contract";
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
import { SECRET, brandReviewerId, createKeyProvider } from "./fixtures";
import { testLogger } from "./logging";
import {
  arrangeFakeGate,
  buildFakeAuthDeps,
  buildFakeInstallationDeps,
} from "./reviewer-github";
import { seedSignIn } from "./sign-in";

vi.setConfig({ testTimeout: 10_000 });

const REPO_ID = 424242;
const REPO = { owner: "octo", repo: "hello" };
const SUGGESTIONS_PATH = `/api/repos/${REPO_ID}/mention-suggestions`;
const TARGETS_PATH = `/api/repos/${REPO_ID}/mention-targets`;

const CARA = {
  login: "cara",
  name: "Cara Example",
  avatarUrl: "https://avatars.example/cara.png",
};
const BACKEND = { combinedSlug: "octo/backend", name: "Backend" } as const;

async function getWithCookie(
  app: ApiApp,
  cookie: string,
  path: string,
): Promise<Response> {
  return await app.request(path, {
    headers: { cookie: `__Host-mergebrief_session=${cookie}` },
  });
}

const MENTION_OPERATIONS: readonly string[] = [
  "searchMentionableUsers",
  "searchMentionableTeams",
  "resolveMentionTargets",
];

function listMentionCalls(fake: FakeGitHub) {
  const mentionCalls = fake.calls.filter((call) =>
    MENTION_OPERATIONS.includes(call.operation),
  );
  return mentionCalls;
}

describe("mention routes", () => {
  let harness: PgliteHarness;
  let kp: KeyProvider;
  let fake: FakeGitHub;
  let app: ApiApp;

  beforeEach(async () => {
    harness = await createPgliteHarness();
    kp = createKeyProvider();
    fake = makeFakeGitHub();
    arrangeFakeGate(fake, { repoId: REPO_ID, push: false, admin: false });
    fake.addMentionableUsers(REPO, [
      CARA,
      { login: "bob", avatarUrl: "https://avatars.example/bob.png" },
    ]);
    fake.addTeams("octo", [BACKEND]);
    app = createApp({
      logger: testLogger(),
      handle: harness.handle,
      webhookSecret: SECRET,
      auth: buildFakeAuthDeps(kp, fake),
      ...buildFakeInstallationDeps(fake),
    });
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    await harness.close();
  });

  describe("GET mention-suggestions", () => {
    it("suggests users to a read-only viewer on their own token", async () => {
      const { cookie } = await seedSignIn(harness.handle, kp);

      const res = await getWithCookie(app, cookie, `${SUGGESTIONS_PATH}?q=car`);

      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(await res.json()).toEqual({ users: [CARA], teams: [] });
      const calls = listMentionCalls(fake);
      expect(calls.map((call) => call.operation)).toEqual([
        "searchMentionableUsers",
      ]);
      expect(calls[0]?.credential.kind).toBe(CredentialKinds.REVIEWER);
    });

    it("searches teams once the typed text names the owner org", async () => {
      const { cookie } = await seedSignIn(harness.handle, kp);

      const res = await getWithCookie(
        app,
        cookie,
        `${SUGGESTIONS_PATH}?q=octo%2Fback`,
      );

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ users: [], teams: [BACKEND] });
    });

    it("offers the owner's teams while the org name is being typed", async () => {
      const { cookie } = await seedSignIn(harness.handle, kp);

      const res = await getWithCookie(app, cookie, `${SUGGESTIONS_PATH}?q=oc`);

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ users: [], teams: [BACKEND] });
    });

    it("answers no teams when GitHub refuses the team read", async () => {
      fake.failOn("searchMentionableTeams", FakeFailures.FORBIDDEN);
      const { cookie } = await seedSignIn(harness.handle, kp);

      const res = await getWithCookie(app, cookie, `${SUGGESTIONS_PATH}?q=oct`);

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ users: [], teams: [] });
    });

    it("caches a team read the App lacks the permission for", async () => {
      fake.failOn("searchMentionableTeams", FakeFailures.FORBIDDEN);
      const { cookie } = await seedSignIn(harness.handle, kp);

      await getWithCookie(app, cookie, `${SUGGESTIONS_PATH}?q=oct`);
      await getWithCookie(app, cookie, `${SUGGESTIONS_PATH}?q=oct`);

      expect(listMentionCalls(fake)).toHaveLength(2);
    });

    it("answers no users when GitHub refuses the user search", async () => {
      fake.failOn("searchMentionableUsers", FakeFailures.SERVER_ERROR);
      const { cookie } = await seedSignIn(harness.handle, kp);

      const res = await getWithCookie(app, cookie, `${SUGGESTIONS_PATH}?q=car`);

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ users: [], teams: [] });
    });

    it("skips the user search once the text holds a slash", async () => {
      const { cookie } = await seedSignIn(harness.handle, kp);

      await getWithCookie(app, cookie, `${SUGGESTIONS_PATH}?q=octo%2Fback`);

      const operations = listMentionCalls(fake).map((call) => call.operation);
      expect(operations).toEqual(["searchMentionableTeams"]);
    });

    it("matches the owner org ignoring case", async () => {
      const { cookie } = await seedSignIn(harness.handle, kp);

      const res = await getWithCookie(
        app,
        cookie,
        `${SUGGESTIONS_PATH}?q=OCTO%2Fback`,
      );

      expect(await res.json()).toEqual({ users: [], teams: [BACKEND] });
    });

    it("reads no teams for an org other than the owner", async () => {
      const { cookie } = await seedSignIn(harness.handle, kp);

      const res = await getWithCookie(
        app,
        cookie,
        `${SUGGESTIONS_PATH}?q=other%2Fback`,
      );

      expect(await res.json()).toEqual({ users: [], teams: [] });
      expect(listMentionCalls(fake)).toEqual([]);
    });

    it("asks GitHub again after a failed search", async () => {
      fake.failOn("searchMentionableUsers", FakeFailures.SERVER_ERROR);
      const { cookie } = await seedSignIn(harness.handle, kp);

      await getWithCookie(app, cookie, `${SUGGESTIONS_PATH}?q=car`);
      await getWithCookie(app, cookie, `${SUGGESTIONS_PATH}?q=car`);

      expect(listMentionCalls(fake)).toHaveLength(2);
    });

    it("answers 401 when GitHub refuses the viewer token", async () => {
      fake.failOn("searchMentionableUsers", FakeFailures.UNAUTHORIZED);
      const { cookie } = await seedSignIn(harness.handle, kp);

      const res = await getWithCookie(app, cookie, `${SUGGESTIONS_PATH}?q=car`);

      expect(res.status).toBe(401);
    });

    it("answers 401 when only the team read finds the token dead", async () => {
      fake.failOn("searchMentionableTeams", FakeFailures.UNAUTHORIZED);
      const { cookie } = await seedSignIn(harness.handle, kp);

      const res = await getWithCookie(
        app,
        cookie,
        `${SUGGESTIONS_PATH}?q=octo%2Fback`,
      );

      expect(res.status).toBe(401);
    });

    it("refuses typed text past the bound", async () => {
      const { cookie } = await seedSignIn(harness.handle, kp);
      const pastBound = "a".repeat(MentionBounds.QUERY_LENGTH + 1);

      const res = await getWithCookie(
        app,
        cookie,
        `${SUGGESTIONS_PATH}?q=${pastBound}`,
      );

      expect(res.status).toBe(400);
      expect(listMentionCalls(fake)).toEqual([]);
    });

    it("caches per viewer, so a second viewer reads GitHub again", async () => {
      const { cookie } = await seedSignIn(harness.handle, kp);
      const { cookie: otherCookie } = await seedSignIn(harness.handle, kp, {
        reviewer: { id: brandReviewerId(556n), login: "hubot" },
      });

      await getWithCookie(app, cookie, `${SUGGESTIONS_PATH}?q=car`);
      await getWithCookie(app, cookie, `${SUGGESTIONS_PATH}?q=CAR`);
      await getWithCookie(app, otherCookie, `${SUGGESTIONS_PATH}?q=car`);

      expect(listMentionCalls(fake)).toHaveLength(2);
    });
  });

  describe("GET mention-targets", () => {
    it("answers the targets GitHub shows the viewer", async () => {
      const { cookie } = await seedSignIn(harness.handle, kp);

      const res = await getWithCookie(
        app,
        cookie,
        `${TARGETS_PATH}?targets=Cara,nobody,octo/backend`,
      );

      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(await res.json()).toEqual({
        users: ["cara"],
        teams: ["octo/backend"],
      });
      expect(listMentionCalls(fake)[0]?.credential.kind).toBe(
        CredentialKinds.REVIEWER,
      );
    });

    it("refuses a target that is no login or team", async () => {
      const { cookie } = await seedSignIn(harness.handle, kp);

      const res = await getWithCookie(
        app,
        cookie,
        `${TARGETS_PATH}?targets=cara,-bad-`,
      );

      expect(res.status).toBe(400);
      expect(listMentionCalls(fake)).toEqual([]);
    });

    it("refuses more targets than one call takes", async () => {
      const { cookie } = await seedSignIn(harness.handle, kp);
      const targets = Array.from({ length: 51 }, (_, index) => `u${index}`);

      const res = await getWithCookie(
        app,
        cookie,
        `${TARGETS_PATH}?targets=${targets.join(",")}`,
      );

      expect(res.status).toBe(400);
    });

    it("accepts an enterprise-managed login", async () => {
      const { cookie } = await seedSignIn(harness.handle, kp);

      const res = await getWithCookie(
        app,
        cookie,
        `${TARGETS_PATH}?targets=mona_octocorp`,
      );

      expect(res.status).toBe(200);
    });

    it("dedupes targets ignoring case and caches the answer", async () => {
      const { cookie } = await seedSignIn(harness.handle, kp);
      const path = `${TARGETS_PATH}?targets=cara,CARA`;

      await getWithCookie(app, cookie, path);
      await getWithCookie(app, cookie, path);

      const calls = listMentionCalls(fake);
      expect(calls).toHaveLength(1);
      expect(calls[0]?.input).toEqual({
        targets: [{ kind: "user", login: "CARA" }],
      });
    });

    it("asks GitHub again after a failed lookup", async () => {
      fake.failOn("resolveMentionTargets", FakeFailures.SERVER_ERROR);
      const { cookie } = await seedSignIn(harness.handle, kp);

      await getWithCookie(app, cookie, `${TARGETS_PATH}?targets=cara`);
      await getWithCookie(app, cookie, `${TARGETS_PATH}?targets=cara`);

      expect(listMentionCalls(fake)).toHaveLength(2);
    });

    it("answers 401 when GitHub refuses the viewer token", async () => {
      fake.failOn("resolveMentionTargets", FakeFailures.UNAUTHORIZED);
      const { cookie } = await seedSignIn(harness.handle, kp);

      const res = await getWithCookie(
        app,
        cookie,
        `${TARGETS_PATH}?targets=cara`,
      );

      expect(res.status).toBe(401);
    });

    it("answers nothing resolved when GitHub fails the lookup", async () => {
      fake.failOn("resolveMentionTargets", FakeFailures.SERVER_ERROR);
      const { cookie } = await seedSignIn(harness.handle, kp);

      const res = await getWithCookie(
        app,
        cookie,
        `${TARGETS_PATH}?targets=cara`,
      );

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ users: [], teams: [] });
    });
  });
});
