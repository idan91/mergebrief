// `/api/local-briefs`: the dev file surface behind the session layer. Each
// read answers its file or a curated code, and with no directory configured,
// production included, every path answers exactly as an unmounted one.
import { join } from "node:path";
import type { KeyProvider } from "persistence";
import { createPgliteHarness, type PgliteHarness } from "persistence/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config";
import { createApp, type ApiApp } from "../src/index";
import { MAX_BRIEF_ID_LENGTH } from "../src/routes/local-briefs/consts";
import { buildAuthDeps, createKeyProvider } from "./fixtures";
import {
  FIRST_SHA,
  REVIEW_COMMENTS,
  SECOND_ID,
  SECOND_SHA,
  buildMarksJson,
  buildRevisionChangesJson,
  buildStoredBriefJson,
  makeOutDir,
  makeUnreadableArtifact,
  removeOutDirs,
  writeArtifacts,
} from "./local-briefs-fixtures";
import { testLogger } from "./logging";
import { seedSession } from "./session/fixtures";

const COOKIE_NAME = "__Host-mergebrief_session";
const LIST_PATH = "/api/local-briefs";
const UNMOUNTED_PATH = "/api/no-such-surface";

function buildIdPaths(id: string): string[] {
  const base = `${LIST_PATH}/${id}`;
  return [
    base,
    `${base}/diffs`,
    `${base}/comparison-marks`,
    `${base}/revision-narrative`,
  ];
}

const ALL_PATHS = [LIST_PATH, ...buildIdPaths(SECOND_ID)];

const ARTIFACTS: Readonly<Record<string, string>> = {
  [`${SECOND_ID}.brief.json`]: buildStoredBriefJson(SECOND_SHA, 2, "Second"),
  [`${SECOND_ID}.comments.json`]: JSON.stringify(REVIEW_COMMENTS),
  [`${SECOND_ID}.diffs.json`]: JSON.stringify([{ file: "a.ts", patch: "+" }]),
  [`${SECOND_ID}.revchanges.json`]: buildRevisionChangesJson(
    FIRST_SHA,
    SECOND_SHA,
  ),
  [`${SECOND_ID}.comparison.json`]: buildMarksJson(
    FIRST_SHA,
    SECOND_SHA,
    "checkpoint",
    null,
  ),
  [`${SECOND_ID}.revision-narrative.json`]: JSON.stringify({ summary: "n" }),
};

describe("/api/local-briefs", () => {
  let harness: PgliteHarness;
  let kp: KeyProvider;
  let dir: string;

  beforeEach(async () => {
    harness = await createPgliteHarness();
    kp = createKeyProvider();
    dir = await makeOutDir();
  });

  afterEach(async () => {
    await harness.close();
    await removeOutDirs();
  });

  function buildApp(localBriefsDir: string | undefined): ApiApp {
    return createApp({
      logger: testLogger(),
      handle: harness.handle,
      webhookSecret: "test-webhook-secret",
      auth: buildAuthDeps(kp),
      localBriefsDir,
      github: {
        fetchPullRequestConversation: async () => {
          throw new Error("github port must not be called in this suite");
        },
        listRepoCollaborators: async () => {
          throw new Error("github port must not be called in this suite");
        },
        commitAttachment: async () => {
          throw new Error("attachment port must not be called in this suite");
        },
        deleteAttachmentBranch: async () => {
          throw new Error("attachment port must not be called in this suite");
        },
      },
    });
  }

  async function readSignedIn(app: ApiApp, path: string): Promise<Response> {
    const cookie = await seedSession(harness.handle, kp);
    return app.request(path, {
      headers: { Cookie: `${COOKIE_NAME}=${cookie}` },
    });
  }

  async function readUnmounted(app: ApiApp): Promise<string> {
    const unmounted = await app.request(UNMOUNTED_PATH);
    expect(unmounted.status).toBe(404);
    return unmounted.text();
  }

  describe("with a directory configured", () => {
    it("lists the directory's Briefs, no-store", async () => {
      await writeArtifacts(dir, ARTIFACTS);
      const app = buildApp(dir);

      const first = await readSignedIn(app, LIST_PATH);
      expect(first.status).toBe(200);
      expect(first.headers.get("cache-control")).toBe("no-store");
      expect(await first.json()).toEqual([
        expect.objectContaining({
          id: SECOND_ID,
          artifactKind: "brief",
          comparisons: {
            previousBrief: {
              marksId: SECOND_ID,
              baselineSha: FIRST_SHA,
              baselineIndex: 1,
            },
            lastReview: {
              marksId: SECOND_ID,
              baselineSha: FIRST_SHA,
              baselineIndex: null,
            },
          },
        }),
      ]);

      const again = await readSignedIn(app, LIST_PATH);
      expect(again.status).toBe(200);
    });

    it("serves a Brief with its comments in the envelope", async () => {
      await writeArtifacts(dir, ARTIFACTS);
      const app = buildApp(dir);

      const res = await readSignedIn(app, `${LIST_PATH}/${SECOND_ID}`);
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(await res.json()).toEqual({
        artifactKind: "brief",
        body: JSON.parse(ARTIFACTS[`${SECOND_ID}.brief.json`] ?? ""),
        reviewComments: REVIEW_COMMENTS,
      });
    });

    it.each([
      ["diffs", ".diffs.json"],
      ["comparison-marks", ".comparison.json"],
      ["revision-narrative", ".revision-narrative.json"],
    ])("serves the %s sidecar byte for byte", async (segment, suffix) => {
      await writeArtifacts(dir, ARTIFACTS);
      const app = buildApp(dir);

      const res = await readSignedIn(
        app,
        `${LIST_PATH}/${SECOND_ID}/${segment}`,
      );
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(res.headers.get("content-type")).toContain("application/json");
      expect(await res.text()).toBe(ARTIFACTS[`${SECOND_ID}${suffix}`]);
    });

    it.each(ALL_PATHS)("refuses %s without a session", async (path) => {
      const app = buildApp(dir);

      const res = await app.request(path);
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({
        error: "unauthorized",
        code: "unauthorized",
      });
    });

    it.each(buildIdPaths(SECOND_ID))(
      "answers %s not-found for an absent artifact",
      async (path) => {
        const app = buildApp(dir);

        const res = await readSignedIn(app, path);
        expect(res.status).toBe(404);
        expect(res.headers.get("cache-control")).toBe("no-store");
        expect(await res.json()).toEqual({
          error: "not found",
          code: "not-found",
        });
      },
    );

    it.each(buildIdPaths(SECOND_ID))(
      "answers %s artifact-unreadable for a file it cannot read",
      async (path) => {
        await Promise.all(
          Object.keys(ARTIFACTS).map((name) =>
            makeUnreadableArtifact(dir, name),
          ),
        );
        const app = buildApp(dir);

        const res = await readSignedIn(app, path);
        expect(res.status).toBe(500);
        expect(res.headers.get("cache-control")).toBe("no-store");
        const body = await res.text();
        expect(JSON.parse(body)).toEqual({
          error: "artifact unreadable",
          code: "artifact-unreadable",
        });
        expect(body).not.toContain(dir);
      },
    );

    it("answers the list artifact-unreadable for a directory it cannot read", async () => {
      await writeArtifacts(dir, { "not-a-dir": "" });
      const app = buildApp(join(dir, "not-a-dir"));

      const res = await readSignedIn(app, LIST_PATH);
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({
        error: "artifact unreadable",
        code: "artifact-unreadable",
      });
    });

    it("refuses an id outside the charset without echoing it", async () => {
      const app = buildApp(dir);

      const res = await readSignedIn(app, `${LIST_PATH}/bad%20id%2Fpasswd`);
      expect(res.status).toBe(400);
      const body = await res.text();
      expect(JSON.parse(body)).toEqual({
        error: "invalid request",
        code: "invalid-request",
      });
      expect(body).not.toContain("passwd");
    });

    it("refuses an id past the filename cap on every id path", async () => {
      const app = buildApp(dir);
      const overlong = "a".repeat(MAX_BRIEF_ID_LENGTH + 1);

      for (const path of buildIdPaths(overlong)) {
        const res = await readSignedIn(app, path);
        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({
          error: "invalid request",
          code: "invalid-request",
        });
      }
    });

    it("reads an id at the filename cap as absent on every id path", async () => {
      expect(MAX_BRIEF_ID_LENGTH).toBe(231);
      const app = buildApp(dir);
      const longest = "a".repeat(MAX_BRIEF_ID_LENGTH);

      for (const path of buildIdPaths(longest)) {
        const res = await readSignedIn(app, path);
        expect(res.status).toBe(404);
        expect(await res.json()).toEqual({
          error: "not found",
          code: "not-found",
        });
      }
    });
  });

  describe("with no directory configured", () => {
    it.each(ALL_PATHS)("answers %s as an unmounted path", async (path) => {
      await writeArtifacts(dir, ARTIFACTS);
      const app = buildApp(undefined);
      const unmounted = await readUnmounted(app);

      const anonymous = await app.request(path);
      expect(anonymous.status).toBe(404);
      expect(await anonymous.text()).toBe(unmounted);

      const signedIn = await readSignedIn(app, path);
      expect(signedIn.status).toBe(404);
      expect(signedIn.headers.get("mergebrief-version")).toBeNull();
      expect(await signedIn.text()).toBe(unmounted);
    });

    it("stays absent in production whatever MERGEBRIEF_OUT_DIR says", async () => {
      await writeArtifacts(dir, ARTIFACTS);
      const config = loadConfig({
        PUBLIC_BASE_URL: "https://app.example.test",
        MERGEBRIEF_OUT_DIR: dir,
        MERGEBRIEF_RUNTIME: "compose-worker",
      });
      if (!config.ok) {
        throw new Error("expected a valid config");
      }
      const app = buildApp(config.value.localBriefsDir);
      const unmounted = await readUnmounted(app);

      const res = await readSignedIn(app, LIST_PATH);
      expect(res.status).toBe(404);
      expect(await res.text()).toBe(unmounted);
    });
  });
});
