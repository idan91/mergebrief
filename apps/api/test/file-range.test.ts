// GET .../file-range over PGlite: one file's line window at a commit, read on
// the viewer's binding through the `github/testing` fake and held per session.
import { RepoFileKinds, type RepoFileResult } from "github";
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
} from "persistence";
import { createPgliteHarness, type PgliteHarness } from "persistence/testing";
import { PrStates } from "types/pull-requests";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, type ApiApp } from "../src/index";
import {
  FILE_BLOB_CACHE_MAX_ENTRIES,
  FILE_BLOB_MAX_BYTES,
} from "../src/routes/repos/pr/reads/consts";
import { createTtlCache } from "../src/routes/ttl-cache";
import {
  INSTALLATION_ID,
  PR_NUMBER,
  REPO_SLUG,
  SECRET,
  brandInstallationId,
  brandRepoId,
  createKeyProvider,
} from "./fixtures";
import { testLogger } from "./logging";
import { spyPullRequestLookups } from "./pull-request-lookups";
import {
  UNUSED_INSTALLATION_DEPS,
  buildFakeAuthDeps,
  arrangeFakeGate,
  listCallsPastGate,
} from "./reviewer-github";
import { seedSignIn } from "./sign-in";

const REPO_ID = 424242;
const REPO = { owner: "octo", repo: "hello" };
const CTX = { installationId: brandInstallationId(BigInt(INSTALLATION_ID)) };
const HEAD_SHA = `${"0".repeat(39)}a`;
const FILE_PATH = "src/app.ts";
const RANGE_PATH = `/api/repos/${REPO_ID}/pulls/${PR_NUMBER}/file-range`;
const OVER_CAP_BYTES = 9_000_000;

function makeTextFile(content: string, size = content.length): RepoFileResult {
  return { kind: RepoFileKinds.FILE, content, blobSha: "blob-sha", size };
}

async function seedPullRequest(handle: AppDatabase): Promise<void> {
  await createTenantRepository(handle, CTX).pullRequests.upsert({
    repoId: brandRepoId(BigInt(REPO_ID)),
    prNumber: PR_NUMBER,
    repoSlug: REPO_SLUG,
    state: PrStates.OPEN,
  });
}

describe("file range read", () => {
  let harness: PgliteHarness;
  let kp: KeyProvider;
  let fake: FakeGitHub;
  let app: ApiApp;
  let cookie: string;

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
    ({ cookie } = await seedSignIn(harness.handle, kp));
    await seedPullRequest(harness.handle);
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await harness.close();
  });

  function readRange(query: string, sessionCookie = cookie) {
    return app.request(`${RANGE_PATH}?${query}`, {
      headers: { Cookie: `__Host-mergebrief_session=${sessionCookie}` },
    });
  }

  function readWindow(from: number, to: number, sessionCookie = cookie) {
    const query = `ref=${HEAD_SHA}&path=${FILE_PATH}&from=${from}&to=${to}`;
    return readRange(query, sessionCookie);
  }

  function arrangeFile(result: RepoFileResult): void {
    fake.addRepoFile(REPO, { path: FILE_PATH, ref: HEAD_SHA }, result);
  }

  function listFileReads() {
    return fake.listCalls("fetchRepoFile");
  }

  it("serves the asked window and the file's line count", async () => {
    arrangeFakeGate(fake, { repoId: REPO_ID });
    arrangeFile(makeTextFile("a\nb\nc\nd\n"));
    const lookups = spyPullRequestLookups(harness);

    const res = await readWindow(2, 3);

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({
      path: FILE_PATH,
      ref: HEAD_SHA,
      from: 2,
      to: 3,
      lines: ["b", "c"],
      totalLines: 4,
    });
    expect(listFileReads().map((call) => call.input)).toEqual([
      {
        ...REPO,
        path: FILE_PATH,
        ref: HEAD_SHA,
        maxBytes: FILE_BLOB_MAX_BYTES,
      },
    ]);
    expect(lookups.count()).toBe(1);
  });

  it("reads the blob once for two ranges of the same file", async () => {
    arrangeFakeGate(fake, { repoId: REPO_ID });
    arrangeFile(makeTextFile("a\nb\nc\nd\n"));

    const first = await readWindow(2, 3);
    const second = await readWindow(1, 1);

    expect(first.status).toBe(200);
    expect(await second.json()).toMatchObject({ lines: ["a"] });
    expect(listFileReads()).toHaveLength(1);
  });

  it("never serves one session the blob another session cached", async () => {
    arrangeFakeGate(fake, { repoId: REPO_ID });
    arrangeFile(makeTextFile("a\nb\nc\nd\n"));
    const other = await seedSignIn(harness.handle, kp);

    await readWindow(2, 3);
    await readWindow(2, 3, other.cookie);

    expect(listFileReads()).toHaveLength(2);
  });

  it("holds its entry cap, so one reader cannot pin the heap", () => {
    const fileCache = createTtlCache<readonly string[]>(
      FILE_BLOB_CACHE_MAX_ENTRIES,
    );
    const expiresAt = Date.now() + 60_000;
    const overflow = FILE_BLOB_CACHE_MAX_ENTRIES + 10;
    for (let index = 0; index < overflow; index += 1) {
      fileCache.set(`key-${String(index)}`, ["line"], expiresAt);
    }

    expect(fileCache.get("key-0")).toBeUndefined();
    expect(fileCache.get(`key-${String(overflow - 1)}`)).toEqual(["line"]);
  });

  it("refuses a span wider than one read may serve", async () => {
    arrangeFakeGate(fake, { repoId: REPO_ID });

    const res = await readWindow(1, 401);

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "invalid-request" });
    expect(listCallsPastGate(fake)).toEqual([]);
  });

  it("refuses a branch name in place of a commit SHA", async () => {
    arrangeFakeGate(fake, { repoId: REPO_ID });

    const res = await readRange(`ref=main&path=${FILE_PATH}&from=1&to=2`);

    expect(res.status).toBe(400);
    expect(listCallsPastGate(fake)).toEqual([]);
  });

  it("tells an absent path apart from a repo the reader cannot see", async () => {
    arrangeFakeGate(fake, { repoId: REPO_ID });

    const res = await readWindow(2, 3);

    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: "file-not-found" });
  });

  // The BARE 404, never file-not-found: a reader must not be able to tell a
  // repo they cannot see from a path that is not there.
  it("collapses a forbidden read to the gate's bare 404", async () => {
    arrangeFakeGate(fake, { repoId: REPO_ID });
    fake.failOn("fetchRepoFile", FakeFailures.FORBIDDEN);

    const res = await readWindow(2, 3);

    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: "not-found" });
  });

  it("answers 413 for a blob over the byte cap", async () => {
    arrangeFakeGate(fake, { repoId: REPO_ID });
    arrangeFile(makeTextFile("x", OVER_CAP_BYTES));

    const res = await readWindow(2, 3);

    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ code: "file-too-large" });
  });

  it("answers 400 for a blob that is not text", async () => {
    arrangeFakeGate(fake, { repoId: REPO_ID });
    arrangeFile(makeTextFile("a\u0000b"));

    const res = await readWindow(2, 3);

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "file-not-text" });
  });

  const permanentRefusals = [
    ["a blob that does not decode", FakeFailures.NOT_TEXT],
    ["a submodule pointer", FakeFailures.NOT_A_BLOB],
  ] as const;

  it.each(permanentRefusals)(
    "answers 400 for %s, with no retry",
    async (_label, failure) => {
      arrangeFakeGate(fake, { repoId: REPO_ID });
      fake.failRepoFile(REPO, { path: FILE_PATH, ref: HEAD_SHA }, failure);

      const res = await readWindow(2, 3);

      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ code: "file-not-text" });
      expect(listFileReads()).toHaveLength(1);
    },
  );

  it("answers 401 when the read still 401s after a good refresh", async () => {
    const gate = arrangeFakeGate(fake, { repoId: REPO_ID });
    fake.failOn(
      "fetchRepoFile",
      FakeFailures.UNAUTHORIZED,
      CredentialKinds.REVIEWER,
    );

    const res = await readWindow(2, 3);

    expect(res.status).toBe(401);
    expect(gate.tokenRefreshes()).toBe(1);
    expect(listFileReads()).toHaveLength(2);
  });

  it("surfaces a rate-limited read as an upstream 502", async () => {
    arrangeFakeGate(fake, { repoId: REPO_ID });
    fake.failOn("fetchRepoFile", FakeFailures.RATE_LIMITED);

    const res = await readWindow(2, 3);

    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ code: "github-unavailable" });
  });
});
