// Write-command tests: payload plumbing (file / stdin / flags, with the
// mutual-exclusion rule pinned), the ONE client-side shape check (the brief
// span, exit 2), receipt passthrough byte-fidelity against the real app, the
// commentsDegraded warning in both modes, and the exit-5 self-correction path
// against REAL server validation.
//
// Long file timeout: octokit's write-path throttle spaces consecutive POSTs
// ~3s, and several tests submit through the real app.
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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
  type KeyProvider,
  type ReviewerId,
  type TenantContext,
} from "persistence";
import { createPgliteHarness, type PgliteHarness } from "persistence/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExitCode } from "../src/exit";
import { buildSubmitPayload, requireSpan } from "../src/commands/write";
import { runCli, type CliDeps } from "../src/program";
import { testLogger } from "./logging";

const KEY_REF = "SESSION_KEY_V1";
const INSTALLATION_ID = 987654;
const REVIEWER_ID = 555;
const REPO_A = 42001;
const BASE_URL = "https://mb.example";
const COMMIT = "c".repeat(40);
const BASE = "d".repeat(40);
const SPAN = ["--base", BASE, "--head", COMMIT];

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

describe("buildSubmitPayload plumbing", () => {
  it("-F payload passes through untouched", () => {
    const payload = { outcome: "comment", body: "looks fine" };
    expect(buildSubmitPayload({ payload })).toBe(payload);
  });

  it("flags build the outcome and body; the comments are the server's", () => {
    expect(buildSubmitPayload({ outcome: "approve", body: "lgtm" })).toEqual({
      outcome: "approve",
      body: "lgtm",
    });
    expect(buildSubmitPayload({})).toEqual({ outcome: "comment" });
  });

  it("the brief span is the ONE client-side shape check (exit 2)", () => {
    for (const [base, head] of [
      [undefined, undefined],
      [BASE, undefined],
      [undefined, COMMIT],
      ["", COMMIT],
    ]) {
      let thrown: unknown;
      try {
        requireSpan(base, head);
      } catch (error) {
        thrown = error;
      }
      expect(
        thrown !== null && typeof thrown === "object" && "code" in thrown
          ? (thrown as { code: number }).code
          : undefined,
      ).toBe(ExitCode.USAGE);
    }
    expect(requireSpan(BASE, COMMIT)).toEqual({ base: BASE, head: COMMIT });
  });

  it("-F and flags are mutually exclusive (defined precedence over silent merge)", () => {
    expect(() =>
      buildSubmitPayload({ payload: { outcome: "comment" }, body: "x" }),
    ).toThrowError(/mutually exclusive/);
  });
});

describe("write commands over the real api app", () => {
  // Octokit's write-path throttle spaces consecutive review POSTs ~3s.
  vi.setConfig({ testTimeout: 30_000 });

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
        if (/\/repos\/[^/]+\/[^/]+\/pulls\/\d+\/reviews$/.test(url)) {
          return jsonResponse({ id: 987001 });
        }
        if (
          /\/pulls\/comments\/\d+\/replies$/.test(url) ||
          /\/comments\/\d+\/replies$/.test(url)
        ) {
          return jsonResponse({ id: 987002 }, 201);
        }
        return jsonResponse({ message: "unexpected endpoint" }, 404);
      }),
    );
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
   * The PR and the brief the submit names.
   */
  async function seedPr(): Promise<void> {
    const repo = createTenantRepository(harness.handle, CTX);
    await repo.pullRequests.upsert({
      repoId: brand(isRepoId, REPO_A),
      prNumber: 7,
      repoSlug: "octo/hello",
      title: "PR 7",
      state: PrStates.OPEN,
    });
    const pr = await repo.pullRequests.getByNumber(brand(isRepoId, REPO_A), 7);
    if (pr === undefined) throw new Error("seedPr: pr missing");
    const brief = await createArtifactStore(harness.handle, CTX).briefs.write({
      pullRequestId: pr.id,
      baseSha: BASE,
      headSha: COMMIT,
      headIndex: 1,
      commitCount: 1,
      provider: "anthropic",
      model: "claude",
      effort: "high",
      body: "{}",
    });
    if (!brief.ok) throw new Error("seedPr: brief write failed");
    const written = await repo.reviewSessions.writeToSession(
      {
        briefId: brief.value.id,
        reviewerId: REVIEWER,
        brief: async () => ({ groupIds: [], flags: [] }),
      },
      () => Promise.resolve(),
    );
    if (!written.ok) throw new Error("seedPr: session seed failed");
  }

  interface Run {
    readonly code: number;
    readonly out: string;
    readonly err: string[];
  }

  async function run(argv: string[], stdin?: string): Promise<Run> {
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
        if (stdin === undefined) throw new Error("stdin not expected");
        return stdin;
      },
      readFile: (path) => readFileSync(path, "utf8"),
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
    expect(code).toBe(ExitCode.OK);
  }

  it("submit -F - (stdin) posts and passes the receipt through verbatim", async () => {
    await seedPr();
    await login();
    const payload = JSON.stringify({ outcome: "comment", body: "looks fine" });
    const result = await run(
      ["submit", "7", "-F", "-", ...SPAN, "--json"],
      payload,
    );
    expect(result.err).toEqual([]);
    expect(result.code).toBe(ExitCode.OK);
    expect(JSON.parse(result.out)).toEqual({
      reviewId: 987001,
      commentsDegraded: false,
    });
  });

  it("submit -F <file> reads the payload from disk", async () => {
    await seedPr();
    await login();
    const path = join(
      mkdtempSync(join(tmpdir(), "mb-payload-")),
      "review.json",
    );
    writeFileSync(path, JSON.stringify({ outcome: "comment", body: "ok" }));
    const result = await run(["submit", "7", "-F", path, ...SPAN, "--json"]);
    expect(result.code).toBe(ExitCode.OK);
  });

  it("submit with convenience flags posts a comment-less review", async () => {
    await seedPr();
    await login();
    const result = await run([
      "submit",
      "7",
      "--outcome",
      "approve",
      "--body",
      "lgtm",
      ...SPAN,
      "--json",
    ]);
    expect(result.code).toBe(ExitCode.OK);
    expect(JSON.parse(result.out)).toEqual({
      reviewId: 987001,
      commentsDegraded: false,
    });
  });

  it("a missing span exits 2 before target resolution, even from a non-covered repo", async () => {
    await login();
    const token = await seedToken();
    const requested: string[] = [];
    const out: string[] = [];
    const err: string[] = [];
    // The fetch boundary would FAIL resolution if reached — the usage error must
    // fire first, so this stub must never see an /api/repos request.
    const failingFetch: CliDeps["fetch"] = async (input, init) => {
      requested.push(input);
      return appFetch(input, init);
    };
    const code = await runCli(
      ["submit", "1", "--outcome", "comment", "--body", "x", "--json"],
      {
        fetch: failingFetch,
        env: { MERGEBRIEF_TOKEN: token },
        configDir,
        cacheDir,
        stdout: (t) => out.push(t),
        stderr: (l) => err.push(l),
        readStdin: async () => {
          throw new Error("stdin not expected");
        },
        // A repo OUTSIDE the token's allowed set: resolution would exit 4.
        gitOriginUrl: () => "git@github.com:nobody/nothing.git",
      },
    );
    expect(code).toBe(ExitCode.USAGE);
    expect(out.join("")).toBe("");
    expect(err).toHaveLength(1);
    expect(err[0]).toContain("--base and --head");
    expect(requested.filter((url) => url.includes("/api/repos"))).toEqual([]);
  });

  it("invalid PR number exits 2 before target resolution, even from a non-covered repo", async () => {
    await login();
    const token = await seedToken();
    const requested: string[] = [];
    const out: string[] = [];
    const err: string[] = [];
    const failingFetch: CliDeps["fetch"] = async (input, init) => {
      requested.push(input);
      return appFetch(input, init);
    };
    const code = await runCli(
      [
        "submit",
        "abc",
        "--outcome",
        "comment",
        "--body",
        "x",
        ...SPAN,
        "--json",
      ],
      {
        fetch: failingFetch,
        env: { MERGEBRIEF_TOKEN: token },
        configDir,
        cacheDir,
        stdout: (t) => out.push(t),
        stderr: (l) => err.push(l),
        readStdin: async () => {
          throw new Error("stdin not expected");
        },
        // A repo OUTSIDE the token's allowed set: resolution would exit 4.
        gitOriginUrl: () => "git@github.com:nobody/nothing.git",
      },
    );
    expect(code).toBe(ExitCode.USAGE);
    expect(out.join("")).toBe("");
    expect(err).toHaveLength(1);
    expect(err[0]).toContain("PR number");
    expect(requested.filter((url) => url.includes("/api/repos"))).toEqual([]);
  });

  it("server validation rejection maps to exit 5 (the self-correction path)", async () => {
    await seedPr();
    await login();
    // request-changes without a body — the server 400s deterministically.
    const result = await run([
      "submit",
      "7",
      "--outcome",
      "request-changes",
      ...SPAN,
      "--json",
    ]);
    expect(result.code).toBe(ExitCode.SERVER_REJECTED);
    expect(result.out).toBe("");
    expect(result.err).toHaveLength(1);
  });

  it("reply --body posts under the comment; receipt is verbatim", async () => {
    await seedPr();
    await login();
    const result = await run([
      "reply",
      "12345",
      "--pr",
      "7",
      "--body",
      "thanks, fixed",
      "--json",
    ]);
    expect(result.code).toBe(ExitCode.OK);
    expect(JSON.parse(result.out)).toEqual({ commentId: 987002 });
  });

  it("reply --body-file - reads the body from stdin", async () => {
    await seedPr();
    await login();
    const result = await run(
      ["reply", "12345", "--pr", "7", "--body-file", "-", "--json"],
      "multi\nline body\n",
    );
    expect(result.code).toBe(ExitCode.OK);
  });

  it("reply without a body source is a usage error", async () => {
    await seedPr();
    await login();
    const result = await run(["reply", "12345", "--pr", "7", "--json"]);
    expect(result.code).toBe(ExitCode.USAGE);
    expect(result.out).toBe("");
  });
});
