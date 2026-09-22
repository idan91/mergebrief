// Read-command tests: passthrough byte-fidelity against the REAL api app, the
// TTY versus --json split, `diff --json` rejection, and both arms of the delta
// union over controlled PR-meta bodies. The arms are pure CLI logic; the
// passthrough tests cover the real wire.
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createArtifactStore,
  encryptToken,
  createTenantRepository,
  createGrantAuth,
  isInstallationId,
  isRepoId,
  isReviewerId,
  PrStates,
  createTokenAuth,
  WriteClassifications,
  type AppDatabase,
  type KeyProvider,
  type ReviewerId,
  type TenantContext,
} from "persistence";
import type { PgliteHarness } from "persistence/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApiClient } from "../src/client";
import { ExitCodes } from "../src/exit";
import { runDelta } from "../src/commands/read";
import {
  BASE_URL,
  KEY_REF,
  startCliApiHarness,
  type CliApiHarness,
} from "./harness/api";
import { STUB_INSTALLATION_ID } from "./harness/github-stub";
import { runCli, type CliDeps } from "../src/program";

const INSTALLATION_ID = STUB_INSTALLATION_ID;
const REVIEWER_ID = 555;
const REPO_A = 42001;
const BASE_SHA = "a".repeat(40);
const HEAD_SHA = "b".repeat(40);

function brand<T extends bigint>(
  guard: (v: bigint) => v is T,
  value: number,
): T {
  const asBigInt = BigInt(value);
  if (!guard(asBigInt)) throw new Error("bad branded id");
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
});

describe("read commands over the real api app", () => {
  let world: CliApiHarness;
  let harness: PgliteHarness;
  let kp: KeyProvider;
  let appFetch: CliDeps["fetch"];
  let configDir: string;
  let cacheDir: string;

  beforeEach(async () => {
    world = await startCliApiHarness();
    harness = world.harness;
    kp = world.keyProvider;
    appFetch = world.fetch;
    configDir = mkdtempSync(join(tmpdir(), "mb-config-"));
    cacheDir = mkdtempSync(join(tmpdir(), "mb-cache-"));
    stubGitHub(world);
  });

  afterEach(async () => {
    await world.close();
  });

  async function seedToken(): Promise<string> {
    const plaintext = `mergebrief_${randomBytes(32).toString("base64url")}`;
    const sealedAccess = await encryptToken(kp, KEY_REF, "ghu_ACCESS");
    const sealedRefresh = await encryptToken(kp, KEY_REF, "ghr_REFRESH");
    if (!sealedAccess.ok || !sealedRefresh.ok)
      throw new Error("seed encrypt failed");
    const grant = await createGrantAuth(harness.handle).createGrant({
      ghTokenCiphertext: sealedAccess.value,
      ghRefreshTokenCiphertext: sealedRefresh.value,
      keyRef: KEY_REF,
      refreshExpiresAt: new Date("2027-01-01T00:00:00Z"),
    });
    await createTokenAuth(harness.handle).mintToken({
      scope: WriteClassifications.EXTERNAL_WRITE,
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
    const write = await createArtifactStore(handle, CTX).briefs.write({
      pullRequestId: pr.id,
      baseSha: BASE_SHA,
      headSha: HEAD_SHA,
      headIndex: 1,
      commitCount: 1,
      provider: "anthropic",
      model: "claude-fable-5",
      effort: "high",
      body: BRIEF_BODY,
    });
    if (!write.ok) throw new Error(`brief seed failed: ${write.error.message}`);
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

  it("pr --json is byte-identical passthrough and TTY renders lines", async () => {
    await seedBriefedPr(harness.handle);
    await login();

    const token = await seedToken();
    const list = await reference(token).request({ path: "/api/pulls" });
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
    await seedBriefedPr(harness.handle);
    await login();
    const result = await run(["groups", "7", "--json"]);
    expect(result.code).toBe(ExitCodes.OK);
    expect(result.out).toBe(BRIEF_BODY);
  });

  it("groups exits 4 with an honest line while the brief is not generated", async () => {
    await createTenantRepository(harness.handle, CTX).pullRequests.upsert({
      repoId: brand(isRepoId, REPO_A),
      prNumber: 7,
      repoSlug: "octo/hello",
      state: PrStates.OPEN,
    });
    await login();
    const result = await run(["groups", "7", "--json"]);
    expect(result.code).toBe(ExitCodes.NOT_FOUND);
    expect(result.out).toBe("");
    expect(result.err).toHaveLength(1);
    expect(result.err[0]).toContain("no brief generated yet");
  });

  it("conversation --json is verbatim passthrough", async () => {
    await seedBriefedPr(harness.handle);
    await login();
    const token = await seedToken();
    const wire = await reference(token).request({
      path: `/api/repos/${REPO_A}/pulls/7/conversation`,
    });
    const result = await run(["conversation", "7", "--json"]);
    expect(result.code).toBe(ExitCodes.OK);
    expect(result.out).toBe(wire.bodyText);
  });

  it("diff rejects --json with exit 2 and passes the raw diff otherwise", async () => {
    await seedBriefedPr(harness.handle);
    await login();

    const rejected = await run(["diff", "7", "--json"]);
    expect(rejected.code).toBe(ExitCodes.USAGE);
    expect(rejected.out).toBe("");
    expect(rejected.err).toHaveLength(1);

    const raw = await run(["diff", "7"]);
    expect(raw.code).toBe(ExitCodes.OK);
    expect(raw.out).toBe(RAW_DIFF);
  });

  it("diff --group keeps only the group's whole hunks; custom span is exit 2", async () => {
    await seedBriefedPr(harness.handle);
    await login();

    const filtered = await run(["diff", "7", "--group", "grp-1"]);
    expect(filtered.code).toBe(ExitCodes.OK);
    expect(filtered.out).toContain("@@ -8,3 +8,5 @@");
    expect(filtered.out).toContain("+added two");
    expect(filtered.out).not.toContain("@@ -40,2 +42,2 @@");
    expect(filtered.out).not.toContain("src/other.ts");

    const custom = await run([
      "diff",
      "7",
      "--group",
      "grp-1",
      "--base",
      BASE_SHA,
    ]);
    expect(custom.code).toBe(ExitCodes.USAGE);
    expect(custom.out).toBe("");

    const unknown = await run(["diff", "7", "--group", "nope"]);
    expect(unknown.code).toBe(ExitCodes.NOT_FOUND);
    expect(unknown.err[0]).toContain('change group "nope"');
  });

  it("delta with explicit baseline and head wraps the artifact verbatim", async () => {
    await seedBriefedPr(harness.handle);
    const deltaBody = '{"artifactKind":"delta","changedGroups":[]}';
    const prRow = await createTenantRepository(
      harness.handle,
      CTX,
    ).pullRequests.getByNumber(brand(isRepoId, REPO_A), 7);
    if (prRow === undefined) throw new Error("seed missing");
    const write = await createArtifactStore(harness.handle, CTX).deltas.write({
      pullRequestId: prRow.id,
      baselineSha: BASE_SHA,
      headSha: HEAD_SHA,
      provider: "anthropic",
      model: "claude-fable-5",
      effort: "high",
      body: deltaBody,
    });
    if (!write.ok) throw new Error("delta seed failed");
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

function sinkPair() {
  const out: string[] = [];
  return {
    out,
    io: {
      stdout: (t: string) => out.push(t),
      stderr: () => undefined,
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
