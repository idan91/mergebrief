// Repos command + cache tests over the REAL api app behind the injected
// fetch, plus CONTROLLED bodies for the trigger table. Includes the
// stream/exit invariant pin (exit ≠ 0 ⇒ empty stdout, ONE stderr line) — the
// revoked-token arm drives the repos command.
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp, type AuthDeps } from "api";
import {
  encryptToken,
  envKeyProvider,
  grantAuth,
  isInstallationId,
  isReviewerId,
  tokenAuth,
  WriteClassification,
  type KeyProvider,
  type ReviewerId,
  type TenantContext,
} from "persistence";
import { createPgliteHarness, type PgliteHarness } from "persistence/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApiClient } from "../src/client";
import { ExitCode } from "../src/exit";
import { resolveRepoId, type RepoCacheDeps } from "../src/profile/repos";
import { runCli, type CliDeps } from "../src/program";
import { testLogger } from "./logging";

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

describe("mergebrief repos command + cache", () => {
  let harness: PgliteHarness;
  let kp: KeyProvider;
  let appFetch: CliDeps["fetch"];
  let configDir: string;
  let cacheDir: string;

  beforeEach(async () => {
    harness = await createPgliteHarness();
    kp = envKeyProvider({ [KEY_REF]: randomBytes(32).toString("base64") });
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
    const grant = await grantAuth(harness.handle).createGrant({
      ghTokenCiphertext: sealedAccess.value,
      ghRefreshTokenCiphertext: sealedRefresh.value,
      keyRef: KEY_REF,
      refreshExpiresAt: new Date("2027-01-01T00:00:00Z"),
    });
    await tokenAuth(harness.handle).mintToken({
      scope: WriteClassification.EXTERNAL_WRITE,
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
    expect(code).toBe(ExitCode.OK);
  }

  it("repos --json is BYTE-IDENTICAL passthrough and populates the no-TTL cache", async () => {
    stubGitHub(() => [{ id: REPO_A, full_name: "octo/hello" }]);
    const token = await seedToken();
    await login(token);

    // Count /api/repos hits at the CLI's OWN fetch boundary (the server has its
    // separate 60s allowed-set cache — that boundary is the api suite's concern).
    let apiRepoHits = 0;
    const countingFetch: CliDeps["fetch"] = async (input, init) => {
      if (input.endsWith("/api/repos")) apiRepoHits += 1;
      return appFetch(input, init);
    };

    // The server's exact body, captured out-of-band for the fidelity pin.
    const reference = await createApiClient({
      fetch: appFetch,
      baseUrl: BASE_URL,
      token,
    }).request({ path: "/api/repos" });

    const first = deps({ fetch: countingFetch });
    expect(await runCli(["repos", "--json"], first.deps)).toBe(ExitCode.OK);
    expect(first.io.out.join("")).toBe(reference.bodyText);
    expect(apiRepoHits).toBe(1);

    // Second run: served from DISK — no /api/repos request at all (no TTL),
    // and STILL byte-identical: the cache returns raw bytes, never
    // re-serialized.
    const second = deps({ fetch: countingFetch });
    expect(await runCli(["repos", "--json"], second.deps)).toBe(ExitCode.OK);
    expect(apiRepoHits).toBe(1);
    expect(second.io.out.join("")).toBe(reference.bodyText);

    // --refresh bypasses the disk cache.
    const third = deps({ fetch: countingFetch });
    expect(await runCli(["repos", "--refresh", "--json"], third.deps)).toBe(
      ExitCode.OK,
    );
    expect(apiRepoHits).toBe(2);
  });

  it("exit ≠ 0 ⇒ stdout is EMPTY and stderr carries one line (revoked token → 3)", async () => {
    stubGitHub(() => []);
    const token = await seedToken();
    await login(token);
    const rows = await harness.raw(
      "update api_token set revoked_at = now() returning id",
    );
    expect(rows).toHaveLength(1);

    const { deps: d, io } = deps();
    const code = await runCli(["repos", "--refresh", "--json"], d);
    expect(code).toBe(ExitCode.AUTH);
    expect(io.out).toEqual([]);
    expect(io.err).toHaveLength(1);
    expect(io.err[0]).toContain("401");
  });

  describe("resolveRepoId self-healing triggers", () => {
    // The triggers are CLI-side logic — drive them with a CONTROLLED
    // /api/repos fetch so each server body is exact. (Against the real app
    // the server's own 60s allowed-set cache masks a rename within its TTL —
    // that boundary belongs to the api suite; the real-app path is covered by
    // the command tests above.)
    function controlled(
      bodies: () => { repos: { repoId: string; fullName: string }[] },
    ): {
      d: RepoCacheDeps;
      hits: () => number;
    } {
      let count = 0;
      const fetchStub: CliDeps["fetch"] = async () => {
        count += 1;
        return jsonResponse(bodies());
      };
      return {
        d: {
          client: createApiClient({
            fetch: fetchStub,
            baseUrl: BASE_URL,
            token: "mergebrief_x",
          }),
          cacheDir,
          profileName: "default",
        },
        hits: () => count,
      };
    }

    it("cache miss → refresh once → resolve; a hit is disk-only", async () => {
      const { d, hits } = controlled(() => ({
        repos: [{ repoId: String(REPO_A), fullName: "octo/hello" }],
      }));
      expect(await resolveRepoId(d, "octo/hello")).toBe(String(REPO_A));
      expect(hits()).toBe(1);
      expect(await resolveRepoId(d, "octo/hello")).toBe(String(REPO_A));
      expect(hits()).toBe(1);
    });

    it("slug mismatch (rename) → refresh once → self-heal", async () => {
      let renamed = false;
      const { d, hits } = controlled(() => ({
        repos: [
          {
            repoId: String(REPO_A),
            fullName: renamed ? "octo/renamed" : "octo/hello",
          },
        ],
      }));
      expect(await resolveRepoId(d, "octo/hello")).toBe(String(REPO_A));
      renamed = true;
      expect(await resolveRepoId(d, "octo/renamed")).toBe(String(REPO_A));
      expect(hits()).toBe(2);
    });

    it("not-found AFTER refresh is the distinct exit naming the profile", async () => {
      const { d } = controlled(() => ({
        repos: [{ repoId: String(REPO_A), fullName: "octo/hello" }],
      }));
      await expect(resolveRepoId(d, "octo/gone")).rejects.toMatchObject({
        code: ExitCode.NOT_FOUND,
        message: expect.stringContaining('profile "default"'),
      });
    });
  });
});
