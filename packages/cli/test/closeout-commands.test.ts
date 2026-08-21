// Surface-closeout tests: `generate` (URL-box generation over an injected
// engine stub) and `collaborators` (push-gated roster passthrough) against
// the REAL api app, plus the guide pin — every command the operations map
// ships must appear in the packaged --agents guide.
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
import operationsMap from "../product-operations.map.json";
import { AGENTS_GUIDE } from "../src/agents-guide";
import { ExitCode } from "../src/exit";
import { runCli, type CliDeps } from "../src/program";
import { testLogger } from "./logging";

const KEY_REF = "SESSION_KEY_V1";
const INSTALLATION_ID = 987654;
const REVIEWER_ID = 555;
const REPO_A = 42001;
const BASE_URL = "https://mb.example";
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

/** GitHub REST stub; the repo-by-id read carries push permission. */
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
          permissions: { push: true },
        });
      }
      return jsonResponse({ message: "unexpected endpoint" }, 404);
    }),
  );
}

const ROSTER = {
  collaborators: [
    { login: "octocat", avatarUrl: "https://avatars.example/octocat" },
  ],
  hasMore: false,
};

describe("generate + collaborators over the real api app", () => {
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
        listRepoCollaborators: async () => ({
          ok: true as const,
          value: ROSTER,
        }),
      },
      urlBriefEngine: {
        fetchHeadSha: async () => ({ ok: true as const, value: HEAD_SHA }),
        lookupIndex: async () => null,
        generate: async () => ({
          ok: true as const,
          value: {
            repo: "octo/hello",
            number: 7,
            index: 1,
            head: HEAD_SHA,
          },
        }),
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
      name: "ci-token",
      tokenHash: createHash("sha256").update(plaintext).digest("hex"),
      grantId: grant.id,
      expiresAt: null,
    });
    return plaintext;
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
    expect(code).toBe(ExitCode.OK);
  }

  it("generate <url> runs with no confirm prompt; receipt verbatim", async () => {
    await login();
    const result = await run([
      "generate",
      "https://github.com/octo/hello/pull/7",
      "--json",
    ]);
    expect(result.err).toEqual([]);
    expect(result.code).toBe(ExitCode.OK);
    const parsed: unknown = JSON.parse(result.out);
    if (typeof parsed !== "object" || parsed === null) {
      throw new Error(`unexpected receipt: ${result.out}`);
    }
    expect(typeof Reflect.get(parsed, "briefId")).toBe("string");
  });

  it("generate with a non-PR URL relays the 400 (exit 5)", async () => {
    await login();
    const result = await run([
      "generate",
      "https://example.com/not-a-pr",
      "--json",
    ]);
    expect(result.code).toBe(ExitCode.SERVER_REJECTED);
    expect(result.out).toBe("");
    expect(result.err).toHaveLength(1);
  });

  it("collaborators --json is the roster verbatim", async () => {
    await login();
    const result = await run(["collaborators", "--json"]);
    expect(result.err).toEqual([]);
    expect(result.code).toBe(ExitCode.OK);
    expect(JSON.parse(result.out)).toEqual(ROSTER);
  });
});

describe("the packaged agent guide covers the shipped surface", () => {
  it("names every command the operations map ships", () => {
    const commands = Object.values(operationsMap)
      .map((entry) =>
        "command" in entry ? entry.command.replace(/^mergebrief /, "") : "",
      )
      .filter((command) => command !== "")
      .map((command) => command.replace(/ <.*$/, ""));
    for (const command of new Set(commands)) {
      // A noun group may be documented as `risk dismiss|address|reopen`, so
      // the tokens only need to appear in order on one line.
      const inOrder = new RegExp(
        command
          .split(" ")
          .map((token) => `\\b${token}\\b`)
          .join("[^\\n]*"),
      );
      expect(
        inOrder.test(AGENTS_GUIDE),
        `guide is missing \`${command}\``,
      ).toBe(true);
    }
  });
});
