// Command tests over the REAL api Hono app (the injected-fetch boundary:
// `app.request` is fetch-shaped) on PGlite — true integration, no network,
// no mock drift. Assertions live on the contract surface: captured stdout /
// stderr + exit code, passthrough byte-fidelity, and the repos cache's
// self-healing triggers.
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp, type AuthDeps } from "api";
import {
  encryptToken,
  createEnvKeyProvider,
  createGrantAuth,
  isInstallationId,
  isReviewerId,
  createTokenAuth,
  WriteClassifications,
  type KeyProvider,
  type ReviewerId,
  type TenantContext,
} from "persistence";
import { createPgliteHarness, type PgliteHarness } from "persistence/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExitCodes } from "../src/exit";
import { testLogger } from "./logging";
import { runCli, type CliDeps } from "../src/program";

const KEY_REF = "SESSION_KEY_V1";
const INSTALLATION_ID = 987654;
const REVIEWER_ID = 555;
const REPO_A = 42001;
const BASE_URL = "https://mb.example";

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

/** GitHub stub at the GLOBAL fetch boundary (the api app's octokit uses it). */
function stubGitHub(
  repos: () => ReadonlyArray<{ id: number; full_name: string }>,
): {
  counts: { installationRepos: number };
} {
  const counts = { installationRepos: 0 };
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
        counts.installationRepos += 1;
        const list = repos();
        return jsonResponse({ total_count: list.length, repositories: list });
      }
      return jsonResponse({ message: "unexpected endpoint" }, 404);
    }),
  );
  return { counts };
}

interface Captured {
  readonly out: string[];
  readonly err: string[];
}

describe("mergebrief commands over the real api app", () => {
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
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await harness.close();
  });

  async function seedToken(): Promise<string> {
    const plaintext = `mergebrief_${randomBytes(32).toString("base64url")}`;
    const hash = createHash("sha256").update(plaintext).digest("hex");
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
      userLogin: "octocat",
      name: "ci-token",
      tokenHash: hash,
      grantId: grant.id,
      expiresAt: null,
    });
    return plaintext;
  }

  function deps(overrides: Partial<CliDeps> = {}): {
    deps: CliDeps;
    io: Captured;
  } {
    const io: Captured = { out: [], err: [] };
    return {
      io,
      deps: {
        fetch: appFetch,
        env: {},
        configDir,
        cacheDir,
        stdout: (text) => io.out.push(text),
        stderr: (line) => io.err.push(line),
        readStdin: async () => {
          throw new Error("stdin not expected");
        },
        gitOriginUrl: () => undefined,
        ...overrides,
      },
    };
  }

  async function login(token: string): Promise<void> {
    const { deps: d } = deps({ readStdin: async () => `${token}\n` });
    const code = await runCli(
      ["auth", "login", "--base-url", BASE_URL, "--json"],
      d,
    );
    expect(code).toBe(ExitCodes.OK);
  }

  it("auth login stores the token 0600 and reports the status shape", async () => {
    stubGitHub(() => [{ id: REPO_A, full_name: "octo/hello" }]);
    const token = await seedToken();
    const { deps: d, io } = deps({ readStdin: async () => `${token}\n` });

    const code = await runCli(
      ["auth", "login", "--base-url", BASE_URL, "--json"],
      d,
    );
    expect(code).toBe(ExitCodes.OK);
    expect(io.err).toEqual([]);

    const status: unknown = JSON.parse(io.out.join(""));
    expect(status).toEqual({
      profile: "default",
      baseUrl: BASE_URL,
      tokenConfigured: true,
      server: { reachable: true, authenticated: true, version: "test-version" },
    });

    const configPath = join(configDir, "config.json");
    const mode = statSync(configPath).mode & 0o777;
    expect(mode).toBe(0o600);
    expect(readFileSync(configPath, "utf8")).toContain(token);
  });

  it("auth login rejects a non-mergebrief paste as usage (exit 2, empty stdout)", async () => {
    const { deps: d, io } = deps({ readStdin: async () => "ghp_not_ours\n" });
    const code = await runCli(
      ["auth", "login", "--base-url", BASE_URL, "--json"],
      d,
    );
    expect(code).toBe(ExitCodes.USAGE);
    expect(io.out).toEqual([]);
    expect(io.err).toHaveLength(1);
  });

  it("auth status models a dead token as DATA (exit 0, authenticated:false)", async () => {
    stubGitHub(() => []);
    await login(await seedToken());
    // Sabotage: a well-formed but unknown token via the env override.
    const { deps: d, io } = deps({
      env: {
        MERGEBRIEF_TOKEN: `mergebrief_${randomBytes(32).toString("base64url")}`,
      },
    });
    const code = await runCli(["auth", "status", "--json"], d);
    expect(code).toBe(ExitCodes.OK);
    const status = JSON.parse(io.out.join("")) as {
      server: { reachable: boolean; authenticated: boolean | null };
    };
    expect(status.server).toEqual({
      reachable: true,
      authenticated: false,
      version: null,
    });
  });

  it("an unknown flag is a usage error (exit 2)", async () => {
    const { deps: d } = deps();
    expect(await runCli(["repos", "--bogus"], d)).toBe(ExitCodes.USAGE);
  });
});

function freshIo(): { out: string[]; err: string[] } {
  return { out: [], err: [] };
}

describe("auth login profile selection + verification", () => {
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
    const app = createApp({
      logger: testLogger(),
      handle: harness.handle,
      webhookSecret: "test-webhook-secret",
      auth: {
        oauthClientId: "Iv1.test-client-id",
        oauthClientSecret: "test-client-secret",
        keyProvider: kp,
        sessionKeyRef: KEY_REF,
        publicBaseUrl: BASE_URL,
        cookieSecure: true,
      },
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
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await harness.close();
  });

  it("MERGEBRIEF_PROFILE selects the login target like --profile", async () => {
    const captured = freshIo();
    const code = await runCli(
      ["auth", "login", "--base-url", BASE_URL, "--json"],
      {
        fetch: appFetch,
        env: { MERGEBRIEF_PROFILE: "work" },
        configDir,
        cacheDir,
        stdout: (t) => captured.out.push(t),
        stderr: (l) => captured.err.push(l),
        readStdin: async () => "mergebrief_pasted\n",
        gitOriginUrl: () => undefined,
      },
    );
    expect(code).toBe(ExitCodes.OK);
    const config = readFileSync(join(configDir, "config.json"), "utf8");
    expect(config).toContain('"work"');
    const status = JSON.parse(captured.out.join("")) as { profile: string };
    expect(status.profile).toBe("work");
  });

  it("login verifies the PASTED token, not the MERGEBRIEF_TOKEN override", async () => {
    // A live env token must not make an invalid paste look authenticated.
    const plaintext = `mergebrief_${randomBytes(32).toString("base64url")}`;
    const hash = createHash("sha256").update(plaintext).digest("hex");
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
      name: "live",
      tokenHash: hash,
      grantId: grant.id,
      expiresAt: null,
    });

    const captured = freshIo();
    const code = await runCli(
      ["auth", "login", "--base-url", BASE_URL, "--json"],
      {
        fetch: appFetch,
        env: { MERGEBRIEF_TOKEN: plaintext }, // live token in the env...
        configDir,
        cacheDir,
        stdout: (t) => captured.out.push(t),
        stderr: (l) => captured.err.push(l),
        readStdin: async () => "mergebrief_bogus_paste\n", // ...bogus paste
        gitOriginUrl: () => undefined,
      },
    );
    expect(code).toBe(ExitCodes.OK);
    const status = JSON.parse(captured.out.join("")) as {
      server: { authenticated: boolean | null };
    };
    expect(status.server.authenticated).toBe(false);
  });
});
