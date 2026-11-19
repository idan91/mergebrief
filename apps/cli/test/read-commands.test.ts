// Read-command tests: passthrough byte-fidelity against the REAL api app, the
// TTY versus --json split, the `--group` hunk filter, and both arms of the
// delta union over controlled PR-meta bodies. The arms and the not-generated
// refusal are pure CLI logic; the passthrough tests cover the real wire.
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createArtifactStore,
  createGenerationProjection,
  createTenantRepository,
  isInstallationId,
  isRepoId,
  isReviewerId,
  createTokenAuth,
  GenerationKinds,
  type AppDatabase,
  type KeyProvider,
  type ReviewerId,
  type TenantContext,
} from "persistence";
import { seedGrant, type PgliteHarness } from "persistence/testing";
import { ApiErrorCodes, DIFF_MODE_HEADER, DiffModes } from "contract";
import { PrStates, AccessLevels } from "types";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { createApiClient } from "../src/client";
import { ExitCodes } from "../src/exit";
import { runDelta } from "../src/commands/read/run";
import { KEY_REF, startCliApiHarness, type CliApiHarness } from "./harness/api";
import { BASE_URL, FIXTURE_BODY_VERSION } from "./harness/consts";
import { STUB_INSTALLATION_ID } from "./harness/github-stub";
import {
  OFFLINE_REPO_ID,
  OFFLINE_REPOS_ROUTE,
  runCliOffline,
} from "./harness/offline";
import { runCli } from "../src/program";
import type { CliDeps } from "../src/types";

const INSTALLATION_ID = STUB_INSTALLATION_ID;
const REVIEWER_ID = 555;
const REPO_A = 42001;
const BASE_SHA = "a".repeat(40);
const HEAD_SHA = "b".repeat(40);
const SPAN_MODE_HEADERS = { [DIFF_MODE_HEADER]: DiffModes.REVISION_SPAN };

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
const CTX: TenantContext = {
  installationId: brand(isInstallationId, INSTALLATION_ID),
};
const REVIEWER: ReviewerId = brand(isReviewerId, REVIEWER_ID);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      date: new Date().toUTCString(),
    },
  });
}

const RAW_DIFF =
  "diff --git a/src/a.ts b/src/a.ts\n" +
  "--- a/src/a.ts\n" +
  "+++ b/src/a.ts\n" +
  "@@ -8,3 +8,5 @@\n" +
  " ctx\n" +
  "+added one\n" +
  "+added two\n" +
  " ctx\n" +
  " ctx\n" +
  "@@ -40,2 +42,2 @@\n" +
  " ctx\n" +
  " ctx\n" +
  "diff --git a/src/other.ts b/src/other.ts\n" +
  "--- a/src/other.ts\n" +
  "+++ b/src/other.ts\n" +
  "@@ -1,2 +1,3 @@\n" +
  " ctx\n" +
  "+x\n" +
  " ctx\n";

/** GitHub stub: allowed-set + compare-diff endpoints. */
function stubGitHub(world: CliApiHarness): void {
  world.github.serve((url) => {
    if (url.includes("/user/installations/") && url.includes("/repositories")) {
      return jsonResponse({
        total_count: 1,
        repositories: [{ id: REPO_A, full_name: "octo/hello" }],
      });
    }
    if (/\/repositories\/\d+$/.test(url)) {
      return jsonResponse({
        id: REPO_A,
        full_name: "octo/hello",
        private: true,
      });
    }
    if (url.includes("/compare/")) {
      return new Response(RAW_DIFF, {
        status: 200,
        headers: {
          "content-type": "application/vnd.github.v3.diff; charset=utf-8",
          date: new Date().toUTCString(),
        },
      });
    }
    // The conversation read travels the real path: the API mints an
    // installation token and asks GitHub's GraphQL, so the stub answers in
    // GitHub's own shapes rather than short-circuiting the port.
    if (url.endsWith("/access_tokens")) {
      return jsonResponse(
        {
          token: "ghs_installation_token",
          expires_at: "2099-01-01T00:00:00Z",
        },
        201,
      );
    }
    if (url.endsWith("/graphql")) {
      return jsonResponse({
        data: {
          repository: {
            pullRequest: {
              reviewThreads: {
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: [],
              },
              reviews: { pageInfo: { hasNextPage: false }, nodes: [] },
              comments: { pageInfo: { hasNextPage: false }, nodes: [] },
            },
          },
        },
      });
    }
    return jsonResponse({ message: "unexpected endpoint" }, 404);
  });
}

const BRIEF_BODY = JSON.stringify({
  artifactKind: "brief",
  pr: { url: "https://github.com/octo/hello/pull/7" },
  summary: "test brief",
  changeGroups: [{ id: "grp-1", title: "Group one" }],
  chunks: [
    {
      id: "chunk-1",
      changeGroupId: "grp-1",
      file: "src/a.ts",
      addedRanges: [{ start: 10, end: 12 }],
      removedRanges: [],
    },
  ],
  productDiff: {
    availability: "available",
    changes: [
      {
        when: "a reviewer opens the brief",
        after: "the brief opens in full",
        affects: "user-flow",
        beforeSource: "not-shown",
        groupIds: ["grp-1"],
      },
    ],
    hasMore: false,
  },
});

describe("read commands over the real api app", () => {
  let world: CliApiHarness;
  let harness: PgliteHarness;
  let kp: KeyProvider;
  let appFetch: CliDeps["fetch"];
  let configDir: string;
  let cacheDir: string;

  async function startWorld(): Promise<void> {
    world = await startCliApiHarness();
    harness = world.harness;
    kp = world.keyProvider;
    appFetch = world.fetch;
    stubGitHub(world);
  }

  beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), "mb-config-"));
    cacheDir = mkdtempSync(join(tmpdir(), "mb-cache-"));
  });

  async function seedToken(): Promise<string> {
    const plaintext = `mergebrief_${randomBytes(32).toString("base64url")}`;
    const grant = await seedGrant(harness.handle, {
      userId: REVIEWER,
      accessToken: "ghu_ACCESS",
      refreshToken: "ghr_REFRESH",
      keyProvider: kp,
      keyRef: KEY_REF,
      refreshExpiresAt: new Date("2027-01-01T00:00:00Z"),
    });
    await createTokenAuth(harness.handle).mintToken({
      scope: AccessLevels.EXTERNAL_WRITE,
      userId: REVIEWER,
      name: "ci-token",
      tokenHash: createHash("sha256").update(plaintext).digest("hex"),
      grantId: grant.id,
      expiresAt: null,
    });
    return plaintext;
  }

  /** PR row + brief artifact + generation projection (briefAvailable=true). */
  async function seedBriefedPr(handle: AppDatabase): Promise<void> {
    const pr = await createTenantRepository(handle, CTX).pullRequests.upsert({
      repoId: brand(isRepoId, REPO_A),
      prNumber: 7,
      repoSlug: "octo/hello",
      title: "PR 7",
      baseSha: BASE_SHA,
      state: PrStates.OPEN,
    });
    await createArtifactStore(handle, CTX).briefs.write({
      pullRequestId: pr.id,
      baseSha: BASE_SHA,
      headSha: HEAD_SHA,
      headIndex: 1,
      commitCount: 1,
      provider: "anthropic",
      model: "claude-fable-5",
      effort: "high",
      bodyVersion: FIXTURE_BODY_VERSION,
      body: BRIEF_BODY,
      usedGroupIds: [],
    });
  }

  interface Run {
    readonly code: number;
    readonly out: string;
    readonly err: string[];
  }

  async function run(
    argv: string[],
    env: Record<string, string> = {},
  ): Promise<Run> {
    const out: string[] = [];
    const err: string[] = [];
    const token = await seedToken();
    const code = await runCli(argv, {
      fetch: appFetch,
      env: { MERGEBRIEF_TOKEN: token, ...env },
      configDir,
      cacheDir,
      stdout: (t) => out.push(t),
      stderr: (l) => err.push(l),
      readStdin: async () => {
        throw new Error("stdin not expected");
      },
      gitOriginUrl: () => "git@github.com:octo/hello.git",
    });
    return { code, out: out.join(""), err };
  }

  async function login(): Promise<void> {
    const token = await seedToken();
    const out: string[] = [];
    const code = await runCli(
      ["auth", "login", "--base-url", BASE_URL, "--json"],
      {
        fetch: appFetch,
        env: {},
        configDir,
        cacheDir,
        stdout: (t) => out.push(t),
        stderr: () => undefined,
        readStdin: async () => `${token}\n`,
        gitOriginUrl: () => undefined,
      },
    );
    expect(code).toBe(ExitCodes.OK);
  }

  function reference(token: string) {
    return createApiClient({ fetch: appFetch, baseUrl: BASE_URL, token });
  }

  // One world for every test here: a test that writes a row or asserts a gate
  // verdict belongs in the per-test describe below, since it would leak.
  describe("reads over one shared brief seed", () => {
    beforeAll(async () => {
      await startWorld();
      await seedBriefedPr(harness.handle);
    });

    afterAll(async () => {
      await world.close();
    });

    it("pr --json is byte-identical passthrough and TTY renders lines", async () => {
      await login();

      const token = await seedToken();
      const list = await reference(token).request({ path: "/api/inbox" });
      const listRun = await run(["pr", "--json"]);
      expect(listRun.code).toBe(ExitCodes.OK);
      expect(listRun.out).toBe(list.bodyText);

      const meta = await reference(token).request({
        path: `/api/repos/${REPO_A}/pulls/7`,
      });
      const metaRun = await run(["pr", "7", "--json"]);
      expect(metaRun.code).toBe(ExitCodes.OK);
      expect(metaRun.out).toBe(meta.bodyText);

      // TTY split: non-contractual rendering, but never raw JSON.
      const tty = await run(["pr"]);
      expect(tty.code).toBe(ExitCodes.OK);
      expect(tty.out).toContain("octo/hello#7");
      expect(tty.out.startsWith("{")).toBe(false);
    });

    it("groups --json is the brief artifact body, verbatim", async () => {
      await login();
      const result = await run(["groups", "7", "--json"]);
      expect(result.code).toBe(ExitCodes.OK);
      expect(result.out).toBe(BRIEF_BODY);
    });

    it("conversation --json is verbatim passthrough", async () => {
      await login();
      const token = await seedToken();
      const wire = await reference(token).request({
        path: `/api/repos/${REPO_A}/pulls/7/conversation`,
      });
      const result = await run(["conversation", "7", "--json"]);
      expect(result.code).toBe(ExitCodes.OK);
      expect(result.out).toBe(wire.bodyText);
    });

    it("diff relays the raw diff; --group keeps the group's whole hunks", async () => {
      await login();

      const raw = await run(["diff", "7"]);
      expect(raw.code).toBe(ExitCodes.OK);
      expect(raw.out).toBe(RAW_DIFF);
      expect(raw.err).toEqual([
        `diff mode: ${DiffModes.COMPARE}`,
        `revision 1 ${BASE_SHA.slice(0, 7)}..${HEAD_SHA.slice(0, 7)}`,
      ]);

      const filtered = await run(["diff", "7", "--group", "grp-1"]);
      expect(filtered.code).toBe(ExitCodes.OK);
      expect(filtered.out).toContain("@@ -8,3 +8,5 @@");
      expect(filtered.out).toContain("+added two");
      expect(filtered.out).not.toContain("@@ -40,2 +42,2 @@");
      expect(filtered.out).not.toContain("src/other.ts");

      const unknown = await run(["diff", "7", "--group", "nope"]);
      expect(unknown.code).toBe(ExitCodes.NOT_FOUND);
      expect(unknown.err[0]).toContain('change group "nope"');
    });
  });

  describe("reads over rows each test writes for itself", () => {
    beforeEach(async () => {
      await startWorld();
    });

    afterEach(async () => {
      await world.close();
    });

    it("generation --json is verbatim and TTY renders the claims line", async () => {
      await seedBriefedPr(harness.handle);
      const pr = await createTenantRepository(
        harness.handle,
        CTX,
      ).pullRequests.upsert({
        repoId: brand(isRepoId, REPO_A),
        prNumber: 7,
        state: PrStates.OPEN,
      });
      await createGenerationProjection(harness.handle, CTX).upsertPending({
        pullRequestId: pr.id,
        kind: GenerationKinds.BRIEF,
        headSha: HEAD_SHA,
        baselineSha: null,
      });
      await login();

      const token = await seedToken();
      const claims = await reference(token).request({
        path: `/api/repos/${REPO_A}/pulls/7/generation`,
      });
      const jsonRun = await run(["generation", "7", "--json"]);
      expect(jsonRun.code).toBe(ExitCodes.OK);
      expect(jsonRun.out).toBe(claims.bodyText);

      const tty = await run(["generation", "7"]);
      expect(tty.code).toBe(ExitCodes.OK);
      expect(tty.out).toBe(
        `PR 7 · head ${HEAD_SHA.slice(0, 7)} · pending · claims 0 of 3\n`,
      );
    });

    it("delta with explicit baseline and head wraps the artifact verbatim", async () => {
      await seedBriefedPr(harness.handle);
      const deltaBody = '{"artifactKind":"delta","changedGroups":[]}';
      const prRow = await createTenantRepository(
        harness.handle,
        CTX,
      ).pullRequests.getByNumber(brand(isRepoId, REPO_A), 7);
      if (prRow === undefined) {
        throw new Error("seed missing");
      }
      await createArtifactStore(harness.handle, CTX).deltas.write({
        pullRequestId: prRow.id,
        baselineSha: BASE_SHA,
        headSha: HEAD_SHA,
        provider: "anthropic",
        model: "claude-fable-5",
        effort: "high",
        bodyVersion: FIXTURE_BODY_VERSION,
        body: deltaBody,
      });
      await login();

      const ok = await run([
        "delta",
        "7",
        "--baseline",
        BASE_SHA,
        "--head",
        HEAD_SHA,
        "--json",
      ]);
      expect(ok.code).toBe(ExitCodes.OK);
      expect(JSON.parse(ok.out)).toEqual({
        available: true,
        baselineSha: BASE_SHA,
        headSha: HEAD_SHA,
        artifact: JSON.parse(deltaBody),
      });
      // The artifact bytes are spliced verbatim into the envelope.
      expect(ok.out).toContain(deltaBody);

      const missing = await run([
        "delta",
        "7",
        "--baseline",
        "f".repeat(40),
        "--head",
        HEAD_SHA,
        "--json",
      ]);
      expect(missing.code).toBe(ExitCodes.NOT_FOUND);
      expect(missing.out).toBe("");
    });
  });
});

describe("groups over a scripted api", () => {
  it("exits 4 with an honest line while the brief is not generated", async () => {
    const result = await runCliOffline(["groups", "7", "--json"], {
      routes: [
        OFFLINE_REPOS_ROUTE,
        {
          method: "GET",
          path: `/api/repos/${OFFLINE_REPO_ID}/pulls/7`,
          body: JSON.stringify({
            baseSha: null,
            headSha: HEAD_SHA,
            briefAvailable: false,
            comparisons: {},
          }),
        },
      ],
    });
    expect(result.code).toBe(ExitCodes.NOT_FOUND);
    expect(result.out).toBe("");
    expect(result.err).toHaveLength(1);
    expect(result.err[0]).toBe(
      "no brief generated yet for PR 7; `mergebrief generation 7` shows where its generation stands",
    );
    expect(result.requests.map((request) => request.path)).toEqual([
      "/api/repos",
      `/api/repos/${OFFLINE_REPO_ID}/pulls/7`,
    ]);
  });
});

describe("pr <n> over a scripted api", () => {
  it("escapes a hostile span on its one line", async () => {
    const result = await runCliOffline(["pr", "7"], {
      routes: [
        OFFLINE_REPOS_ROUTE,
        {
          method: "GET",
          path: `/api/repos/${OFFLINE_REPO_ID}/pulls/7`,
          body: JSON.stringify({
            baseSha: "\u001B[2Jaaaa",
            headSha: HEAD_SHA,
            briefAvailable: true,
            comparisons: {},
          }),
        },
      ],
    });

    expect(result.code).toBe(ExitCodes.OK);
    expect(result.out).not.toContain("\u001B");
    expect(result.out).toContain("[U+001B][2Ja");
  });
});

describe("TTY renderings over a scripted api", () => {
  const SPOOFED_TITLE = "Fix \u202Etxt.exe \u001B[2Jgone";
  const ESCAPED_TITLE = "Fix [U+202E]txt.exe [U+001B][2Jgone";

  it("escapes a PR title's bidi override and terminal controls", async () => {
    const result = await runCliOffline(["pr"], {
      routes: [
        {
          method: "GET",
          path: "/api/inbox",
          body: JSON.stringify({
            items: [
              {
                repoSlug: "acme/app",
                prNumber: 7,
                title: SPOOFED_TITLE,
                state: "open",
              },
              {
                repoSlug: "acme/app",
                prNumber: 8,
                title: "תיקון באג",
                state: "open",
              },
            ],
          }),
        },
      ],
    });

    expect(result.out).toBe(
      `acme/app#7\t${ESCAPED_TITLE}\topen\nacme/app#8\tתיקון באג\topen\n`,
    );
  });

  it("escapes a group title's bidi override and terminal controls", async () => {
    const span = `base=${BASE_SHA}&head=${HEAD_SHA}`;
    const pull = `/api/repos/${OFFLINE_REPO_ID}/pulls/7`;
    const result = await runCliOffline(["groups", "7"], {
      routes: [
        OFFLINE_REPOS_ROUTE,
        {
          method: "GET",
          path: pull,
          body: JSON.stringify({
            baseSha: BASE_SHA,
            headSha: HEAD_SHA,
            briefAvailable: true,
            revisions: [{ baseSha: BASE_SHA, headSha: HEAD_SHA, headIndex: 1 }],
            comparisons: {},
          }),
        },
        {
          method: "GET",
          path: `${pull}/brief?${span}`,
          body: JSON.stringify({
            changeGroups: [{ id: "grp-1", title: SPOOFED_TITLE }],
          }),
        },
      ],
    });

    expect(result.out).toBe(`grp-1\t${ESCAPED_TITLE}\n`);
  });
});

describe("diff --group over a scripted api", () => {
  function runMissingFiles(file: string) {
    const span = `base=${BASE_SHA}&head=${HEAD_SHA}`;
    const pull = `/api/repos/${OFFLINE_REPO_ID}/pulls/7`;
    return runCliOffline(["diff", "7", "--group", "grp-1"], {
      routes: [
        OFFLINE_REPOS_ROUTE,
        {
          method: "GET",
          path: pull,
          body: JSON.stringify({
            baseSha: BASE_SHA,
            headSha: HEAD_SHA,
            briefAvailable: true,
            revisions: [{ baseSha: BASE_SHA, headSha: HEAD_SHA, headIndex: 1 }],
            comparisons: {},
          }),
        },
        {
          method: "GET",
          path: `${pull}/brief?${span}`,
          body: JSON.stringify({
            chunks: [
              {
                id: "c1",
                changeGroupId: "grp-1",
                file,
                addedRanges: [{ start: 1, end: 1 }],
                removedRanges: [],
              },
            ],
          }),
        },
        {
          method: "GET",
          path: `${pull}/diff?${span}`,
          body: RAW_DIFF,
          headers: SPAN_MODE_HEADERS,
        },
      ],
    });
  }

  it("names a missing file with a bidi override by a visible escape", async () => {
    const result = await runMissingFiles("src/\u202Etxt.exe");

    expect(result.code).toBe(ExitCodes.GENERIC);
    expect(result.err).toHaveLength(1);
    expect(result.err[0]).toContain("(src/[U+202E]txt.exe)");
  });

  it("names a missing Hebrew path as it is", async () => {
    const result = await runMissingFiles("docs/שלום.md");

    expect(result.err[0]).toContain("(docs/שלום.md)");
  });
});

describe("diff over a scripted api", () => {
  const span = `base=${BASE_SHA}&head=${HEAD_SHA}`;
  const diffPath = `/api/repos/${OFFLINE_REPO_ID}/pulls/7/diff?${span}`;
  const argv = ["diff", "7", "--base", BASE_SHA, "--head", HEAD_SHA];

  it("names the revision span on the success-only channel", async () => {
    const notices: string[] = [];
    const result = await runCliOffline(argv, {
      successNotice: (line) => notices.push(line),
      routes: [
        OFFLINE_REPOS_ROUTE,
        {
          method: "GET",
          path: diffPath,
          body: RAW_DIFF,
          headers: SPAN_MODE_HEADERS,
        },
      ],
    });

    expect(result.code).toBe(ExitCodes.OK);
    expect(result.out).toBe(RAW_DIFF);
    expect(notices).toEqual([`diff mode: ${DiffModes.REVISION_SPAN}`]);
    expect(result.err).toEqual([]);
  });

  describe("on a terminal", () => {
    const PLANTED_DIFF =
      "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n" +
      "@@ -0,0 +1 @@\n+evil()\u001B[2K\n";
    const routes = [
      OFFLINE_REPOS_ROUTE,
      { method: "GET", path: diffPath, body: PLANTED_DIFF },
    ];

    it("colors the diff and escapes what the author planted", async () => {
      const result = await runCliOffline(argv, {
        routes,
        stdoutIsTerminal: true,
      });

      expect(result.code).toBe(ExitCodes.OK);
      expect(result.out).toContain("\u001B[32m+evil()[U+001B][2K\u001B[0m\n");
    });

    it("escapes without color under NO_COLOR", async () => {
      const result = await runCliOffline(argv, {
        routes,
        stdoutIsTerminal: true,
        env: { NO_COLOR: "1" },
      });

      expect(result.out).toContain("\n+evil()[U+001B][2K\n");
      expect(result.out).not.toContain("\u001B");
    });

    it("hands a set pager the escaped copy with no color", async () => {
      const paged: string[] = [];
      const result = await runCliOffline(argv, {
        routes,
        stdoutIsTerminal: true,
        pager: async (text) => {
          paged.push(text);
        },
      });

      expect(paged).toEqual([PLANTED_DIFF.replace("\u001B", "[U+001B]")]);
      expect(result.out).toBe("");
    });

    it("keeps a pipe byte for byte", async () => {
      const result = await runCliOffline(argv, { routes });

      expect(result.out).toBe(PLANTED_DIFF);
    });
  });

  it("prints one error line for a refused span, its mode left out", async () => {
    const refusal = JSON.stringify({
      error: "too large",
      code: ApiErrorCodes.DIFF_TOO_LARGE,
    });
    const result = await runCliOffline(argv, {
      routes: [
        OFFLINE_REPOS_ROUTE,
        {
          method: "GET",
          path: diffPath,
          status: 413,
          body: refusal,
          headers: SPAN_MODE_HEADERS,
        },
      ],
    });

    expect(result.code).not.toBe(ExitCodes.OK);
    expect(result.out).toBe("");
    expect(result.err).toHaveLength(1);
  });

  it("prints no mode line when the server names none", async () => {
    const result = await runCliOffline(argv, {
      routes: [
        OFFLINE_REPOS_ROUTE,
        { method: "GET", path: diffPath, body: RAW_DIFF },
      ],
    });

    expect(result.code).toBe(ExitCodes.OK);
    expect(result.err).toEqual([]);
  });
});

describe("groups on a head briefed only on a base the PR has left", () => {
  it("reads the brief at that revision's own span", async () => {
    const pull = `/api/repos/${OFFLINE_REPO_ID}/pulls/7`;
    const result = await runCliOffline(["groups", "7", "--json"], {
      routes: [
        OFFLINE_REPOS_ROUTE,
        {
          method: "GET",
          path: pull,
          body: JSON.stringify({
            baseSha: BASE_SHA,
            headSha: HEAD_SHA,
            briefAvailable: false,
            headBriefStored: true,
            comparisons: {},
            revisions: [{ baseSha: BASE_SHA, headSha: HEAD_SHA, headIndex: 1 }],
          }),
        },
        {
          method: "GET",
          path: `${pull}/brief?base=${BASE_SHA}&head=${HEAD_SHA}`,
          body: JSON.stringify({ changeGroups: [] }),
        },
      ],
    });

    expect(result.code).toBe(ExitCodes.OK);
    expect(JSON.parse(result.out)).toEqual({ changeGroups: [] });
  });
});

function sinkPair() {
  const out: string[] = [];
  return {
    out,
    io: {
      stdout: (t: string) => out.push(t),
      stderr: () => undefined,
      successNotice: () => undefined,
      json: true,
    },
  };
}

describe("delta checkpoint resolution over controlled PR-meta bodies", () => {
  function controlledClient(meta: unknown, deltaBody?: string) {
    return createApiClient({
      fetch: async (input) => {
        if (input.includes("/delta?")) {
          if (deltaBody === undefined) {
            return jsonResponse({ error: "not found" }, 404);
          }
          return new Response(deltaBody, {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        return jsonResponse(meta);
      },
      baseUrl: BASE_URL,
      token: "mergebrief_x",
    });
  }

  const READY_META = {
    baseSha: BASE_SHA,
    headSha: HEAD_SHA,
    briefAvailable: true,
    revisions: [{ baseSha: BASE_SHA, headSha: HEAD_SHA, headIndex: 1 }],
  };

  it("no checkpoint reports available false with reason no-checkpoint", async () => {
    const { out, io: sinks } = sinkPair();
    await runDelta(
      controlledClient({ ...READY_META, comparisons: {} }),
      "1",
      7,
      {},
      sinks,
    );
    expect(JSON.parse(out.join(""))).toEqual({
      available: false,
      reason: "no-checkpoint",
    });
  });

  it("server unavailability reasons pass through the union", async () => {
    for (const reason of ["pending", "baseline-unavailable"]) {
      const { out, io: sinks } = sinkPair();
      await runDelta(
        controlledClient({
          ...READY_META,
          comparisons: { lastReview: { unavailable: reason } },
        }),
        "1",
        7,
        {},
        sinks,
      );
      expect(JSON.parse(out.join(""))).toEqual({ available: false, reason });
    }
  });

  it("marks without a delta core → delta-not-generated", async () => {
    const { out, io: sinks } = sinkPair();
    await runDelta(
      controlledClient({
        ...READY_META,
        comparisons: {
          lastReview: { deltaAvailable: false, baselineSha: BASE_SHA },
        },
      }),
      "1",
      7,
      {},
      sinks,
    );
    expect(JSON.parse(out.join(""))).toEqual({
      available: false,
      reason: "delta-not-generated",
    });
  });

  it("a span with no change of the PR's own reads unchanged", async () => {
    const { out, io: sinks } = sinkPair();
    await runDelta(
      controlledClient({
        ...READY_META,
        comparisons: {
          lastReview: {
            deltaAvailable: false,
            deltaUnchanged: true,
            baselineSha: BASE_SHA,
          },
        },
      }),
      "1",
      7,
      {},
      sinks,
    );
    expect(JSON.parse(out.join(""))).toEqual({
      available: false,
      reason: "unchanged",
    });
  });

  it("a resolved checkpoint fetches the span and wraps the artifact", async () => {
    const { out, io: sinks } = sinkPair();
    const body = '{"artifactKind":"delta"}';
    await runDelta(
      controlledClient(
        {
          ...READY_META,
          comparisons: {
            lastReview: { deltaAvailable: true, baselineSha: BASE_SHA },
          },
        },
        body,
      ),
      "1",
      7,
      {},
      sinks,
    );
    const parsed = JSON.parse(out.join("")) as {
      available: boolean;
      baselineSha: string;
    };
    expect(parsed.available).toBe(true);
    expect(parsed.baselineSha).toBe(BASE_SHA);
  });
});
