// Session-read command tests: passthrough byte-fidelity against the REAL api
// app for the four Review Session reads (`session`, `marks`, `narrative`,
// `context`), each span flag's usage error firing BEFORE any target
// resolution, and 404 relays (exit 4). This file also establishes the
// session seeding harness (brief + session row over PGlite) the later
// session-write suites reuse.
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp, type AuthDeps } from "api";
import {
  createArtifactStore,
  encryptToken,
  createEnvKeyProvider,
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
import { createPgliteHarness, type PgliteHarness } from "persistence/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApiClient } from "../src/client";
import { ExitCodes } from "../src/exit";
import { runCli, type CliDeps } from "../src/program";
import { testLogger } from "./logging";

const KEY_REF = "SESSION_KEY_V1";
const INSTALLATION_ID = 987654;
const REVIEWER_ID = 555;
const REPO_A = 42001;
const BASE_URL = "https://mb.example";
const BASE_SHA = "a".repeat(40);
const HEAD_SHA = "b".repeat(40);
const PREV_HEAD_SHA = "e".repeat(40);
const SPAN = ["--base", BASE_SHA, "--head", HEAD_SHA];

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

/** GitHub stub: the allowed-set + repo-by-id endpoints the gate touches. */
function stubGitHub(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request): Promise<Response> => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (
        url.includes("/user/installations/") &&
        url.includes("/repositories")
      ) {
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
      return jsonResponse({ message: "unexpected endpoint" }, 404);
    }),
  );
}

const REPO_CONFIG = JSON.stringify({ origin: "repo", files: [] });

describe("session read commands over the real api app", () => {
  let harness: PgliteHarness;
  let kp: KeyProvider;
  let appFetch: CliDeps["fetch"];
  let configDir: string;
  let cacheDir: string;

  beforeEach(async () => {
    harness = await createPgliteHarness();
    kp = createEnvKeyProvider({
      [KEY_REF]: randomBytes(32).toString("base64"),
    });
    const auth: AuthDeps = {
      oauthClientId: "Iv1.test-client-id",
      oauthClientSecret: "test-client-secret",
      keyProvider: kp,
      sessionKeyRef: KEY_REF,
      publicBaseUrl: BASE_URL,
      cookieSecure: true,
    };
    const app = createApp({
      logger: testLogger(),
      handle: harness.handle,
      webhookSecret: "test-webhook-secret",
      auth,
      github: {
        fetchPullRequestConversation: async () => {
          throw new Error("conversation port must not be called in this suite");
        },
        listRepoCollaborators: async () => {
          throw new Error(
            "collaborators port must not be called in this suite",
          );
        },
      },
      serverVersion: "test-version",
    });
    appFetch = async (input, init) => app.request(input, init);
    configDir = mkdtempSync(join(tmpdir(), "mb-config-"));
    cacheDir = mkdtempSync(join(tmpdir(), "mb-cache-"));
    stubGitHub();
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await harness.close();
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
      installationId: CTX.installationId,
      userId: REVIEWER,
      name: "ci-token",
      tokenHash: createHash("sha256").update(plaintext).digest("hex"),
      grantId: grant.id,
      expiresAt: null,
    });
    return plaintext;
  }

  /**
   * The session harness: PR row + brief (with a repo-config snapshot) + a
   * MATERIALIZED session row for the reviewer, plus the marks and narrative
   * artifacts the flat reads serve.
   */
  async function seedSessionedPr(handle: AppDatabase): Promise<void> {
    const repo = createTenantRepository(handle, CTX);
    const pr = await repo.pullRequests.upsert({
      repoId: brand(isRepoId, REPO_A),
      prNumber: 7,
      repoSlug: "octo/hello",
      title: "PR 7",
      baseSha: BASE_SHA,
      state: PrStates.OPEN,
    });
    const store = createArtifactStore(handle, CTX);
    const brief = await store.briefs.write({
      pullRequestId: pr.id,
      baseSha: BASE_SHA,
      headSha: HEAD_SHA,
      headIndex: 1,
      commitCount: 1,
      provider: "anthropic",
      model: "claude-fable-5",
      effort: "high",
      body: "{}",
      repoConfig: REPO_CONFIG,
    });
    if (!brief.ok) throw new Error("brief seed failed");
    const session = await repo.reviewSessions.writeToSession(
      {
        briefId: brief.value.id,
        reviewerId: REVIEWER,
        brief: async () => ({ groupIds: [], flags: [] }),
      },
      () => Promise.resolve(),
    );
    if (!session.ok) throw new Error("session seed failed");
    const marks = await store.comparisonMarks.write({
      pullRequestId: pr.id,
      marks: { baselineSha: PREV_HEAD_SHA, headSha: HEAD_SHA, files: [] },
    });
    if (!marks.ok) throw new Error("marks seed failed");
    const narrative = await store.revisionNarratives.write({
      pullRequestId: pr.id,
      briefId: brief.value.id,
      prevHeadSha: PREV_HEAD_SHA,
      headSha: HEAD_SHA,
      provider: "anthropic",
      model: "claude-fable-5",
      effort: "high",
      body: JSON.stringify({ artifactKind: "narrative" }),
    });
    if (!narrative.ok) throw new Error("narrative seed failed");
  }

  interface Run {
    readonly code: number;
    readonly out: string;
    readonly err: string[];
  }

  async function run(argv: string[]): Promise<Run> {
    const out: string[] = [];
    const err: string[] = [];
    const token = await seedToken();
    const code = await runCli(argv, {
      fetch: appFetch,
      env: { MERGEBRIEF_TOKEN: token },
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
    const code = await runCli(
      ["auth", "login", "--base-url", BASE_URL, "--json"],
      {
        fetch: appFetch,
        env: {},
        configDir,
        cacheDir,
        stdout: () => undefined,
        stderr: () => undefined,
        readStdin: async () => `${token}\n`,
        gitOriginUrl: () => undefined,
      },
    );
    expect(code).toBe(ExitCodes.OK);
  }

  async function referenceBody(path: string): Promise<string> {
    const token = await seedToken();
    const client = createApiClient({
      fetch: appFetch,
      baseUrl: BASE_URL,
      token,
    });
    const response = await client.request({ path });
    return response.bodyText;
  }

  it("session --json is verbatim passthrough; TTY prints the body", async () => {
    await seedSessionedPr(harness.handle);
    await login();
    const wire = await referenceBody(
      `/api/repos/${REPO_A}/pulls/7/session?base=${BASE_SHA}&head=${HEAD_SHA}`,
    );
    const result = await run(["session", "7", ...SPAN, "--json"]);
    expect(result.err).toEqual([]);
    expect(result.code).toBe(ExitCodes.OK);
    expect(result.out).toBe(wire);

    const tty = await run(["session", "7", ...SPAN]);
    expect(tty.code).toBe(ExitCodes.OK);
    expect(tty.out).toBe(`${wire}\n`);
  });

  it("session without the span exits 2 before any target resolution", async () => {
    await login();
    const token = await seedToken();
    const requested: string[] = [];
    const out: string[] = [];
    const err: string[] = [];
    const recordingFetch: CliDeps["fetch"] = async (input, init) => {
      requested.push(input);
      return appFetch(input, init);
    };
    const code = await runCli(["session", "7", "--json"], {
      fetch: recordingFetch,
      env: { MERGEBRIEF_TOKEN: token },
      configDir,
      cacheDir,
      stdout: (t) => out.push(t),
      stderr: (l) => err.push(l),
      readStdin: async () => {
        throw new Error("stdin not expected");
      },
      gitOriginUrl: () => "git@github.com:nobody/nothing.git",
    });
    expect(code).toBe(ExitCodes.USAGE);
    expect(out.join("")).toBe("");
    expect(err).toHaveLength(1);
    expect(err[0]).toContain("--base and --head");
    expect(requested.filter((url) => url.includes("/api/repos"))).toEqual([]);
  });

  it("marks --json is verbatim passthrough for (baseline, head)", async () => {
    await seedSessionedPr(harness.handle);
    await login();
    const wire = await referenceBody(
      `/api/repos/${REPO_A}/pulls/7/marks?baseline=${PREV_HEAD_SHA}&head=${HEAD_SHA}`,
    );
    const result = await run([
      "marks",
      "7",
      "--baseline",
      PREV_HEAD_SHA,
      "--head",
      HEAD_SHA,
      "--json",
    ]);
    expect(result.err).toEqual([]);
    expect(result.code).toBe(ExitCodes.OK);
    expect(result.out).toBe(wire);
  });

  it("marks without --baseline/--head exits 2 with one line", async () => {
    await seedSessionedPr(harness.handle);
    await login();
    const result = await run(["marks", "7", "--head", HEAD_SHA, "--json"]);
    expect(result.code).toBe(ExitCodes.USAGE);
    expect(result.out).toBe("");
    expect(result.err).toHaveLength(1);
    expect(result.err[0]).toContain("--baseline and --head");
  });

  it("marks for an unknown span relays the 404 (exit 4)", async () => {
    await seedSessionedPr(harness.handle);
    await login();
    const result = await run([
      "marks",
      "7",
      "--baseline",
      "f".repeat(40),
      "--head",
      HEAD_SHA,
      "--json",
    ]);
    expect(result.code).toBe(ExitCodes.NOT_FOUND);
    expect(result.out).toBe("");
    expect(result.err).toHaveLength(1);
  });

  it("narrative --json is verbatim passthrough for (prevHead, head)", async () => {
    await seedSessionedPr(harness.handle);
    await login();
    const wire = await referenceBody(
      `/api/repos/${REPO_A}/pulls/7/narrative?prevHead=${PREV_HEAD_SHA}&head=${HEAD_SHA}`,
    );
    const result = await run([
      "narrative",
      "7",
      "--prev-head",
      PREV_HEAD_SHA,
      "--head",
      HEAD_SHA,
      "--json",
    ]);
    expect(result.err).toEqual([]);
    expect(result.code).toBe(ExitCodes.OK);
    expect(result.out).toBe(wire);
  });

  it("narrative without --prev-head/--head exits 2 with one line", async () => {
    await seedSessionedPr(harness.handle);
    await login();
    const result = await run([
      "narrative",
      "7",
      "--prev-head",
      PREV_HEAD_SHA,
      "--json",
    ]);
    expect(result.code).toBe(ExitCodes.USAGE);
    expect(result.out).toBe("");
    expect(result.err).toHaveLength(1);
    expect(result.err[0]).toContain("--prev-head and --head");
  });

  it("context --json is verbatim passthrough of the repo-config envelope", async () => {
    await seedSessionedPr(harness.handle);
    await login();
    const wire = await referenceBody(
      `/api/repos/${REPO_A}/pulls/7/brief-context?base=${BASE_SHA}&head=${HEAD_SHA}`,
    );
    const result = await run(["context", "7", ...SPAN, "--json"]);
    expect(result.err).toEqual([]);
    expect(result.code).toBe(ExitCodes.OK);
    expect(result.out).toBe(wire);
    expect(result.out).toContain('"repoConfig"');
  });

  it("context without the span exits 2 with one line", async () => {
    await seedSessionedPr(harness.handle);
    await login();
    const result = await run(["context", "7", "--json"]);
    expect(result.code).toBe(ExitCodes.USAGE);
    expect(result.out).toBe("");
    expect(result.err).toHaveLength(1);
    expect(result.err[0]).toContain("--base and --head");
  });

  it("an invalid PR number exits 2 on every session read", async () => {
    await login();
    for (const argv of [
      ["session", "x", ...SPAN, "--json"],
      ["marks", "x", "--baseline", PREV_HEAD_SHA, "--head", HEAD_SHA, "--json"],
      [
        "narrative",
        "x",
        "--prev-head",
        PREV_HEAD_SHA,
        "--head",
        HEAD_SHA,
        "--json",
      ],
      ["context", "x", ...SPAN, "--json"],
    ]) {
      const result = await run(argv);
      expect(result.code).toBe(ExitCodes.USAGE);
      expect(result.out).toBe("");
      expect(result.err).toHaveLength(1);
      expect(result.err[0]).toContain("PR number");
    }
  });
});
