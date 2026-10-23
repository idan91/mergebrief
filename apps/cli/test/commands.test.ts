// Auth command tests. Login and status run over the REAL API, as its own
// process against a migrated database this file seeds. The paste check and
// the profile selection run over the offline runner and a scripted api,
// where the bearer the login verifies with is read off the request itself.
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  isReviewerId,
  createTokenAuth,
  type KeyProvider,
  type ReviewerId,
} from "persistence";
import { seedGrant, type PgliteHarness } from "persistence/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ExitCodes } from "../src/exit";
import { KEY_REF, startCliApiHarness, type CliApiHarness } from "./harness/api";
import { BASE_URL } from "./harness/consts";
import { expectRefusedBeforeRequest, runCliOffline } from "./harness/offline";
import { CLI_VERSION } from "../src/client";
import { runCli } from "../src/program";
import type { CliDeps } from "../src/types";
import { AccessLevels } from "types/access-levels";

const REVIEWER_ID = 555;
const REPO_A = 42001;

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

/** The GitHub responses this file's API process gets, and the call counts. */
function stubGitHub(
  world: CliApiHarness,
  repos: () => ReadonlyArray<{ id: number; full_name: string }>,
): {
  counts: { installationRepos: number };
} {
  const counts = { installationRepos: 0 };
  world.github.serve((url) => {
    if (url.includes("/user/installations/") && url.includes("/repositories")) {
      counts.installationRepos += 1;
      const list = repos();
      return jsonResponse({ total_count: list.length, repositories: list });
    }
    return jsonResponse({ message: "unexpected endpoint" }, 404);
  });
  return { counts };
}

interface Captured {
  readonly out: string[];
  readonly err: string[];
}

describe("mergebrief commands over the real api", () => {
  let world: CliApiHarness;
  let harness: PgliteHarness;
  let kp: KeyProvider;
  let appFetch: CliDeps["fetch"];
  let configDir: string;
  let cacheDir: string;

  beforeEach(async () => {
    world = await startCliApiHarness({ serverVersion: "test-version" });
    harness = world.harness;
    kp = world.keyProvider;
    appFetch = world.fetch;
    configDir = mkdtempSync(join(tmpdir(), "mb-config-"));
    cacheDir = mkdtempSync(join(tmpdir(), "mb-cache-"));
  });

  afterEach(async () => {
    await world.close();
  });

  async function seedToken(): Promise<string> {
    const plaintext = `mergebrief_${randomBytes(32).toString("base64url")}`;
    const hash = createHash("sha256").update(plaintext).digest("hex");
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
    stubGitHub(world, () => [{ id: REPO_A, full_name: "octo/hello" }]);
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
      cli: { version: CLI_VERSION },
      server: { reachable: true, authenticated: true, version: "test-version" },
    });

    const configPath = join(configDir, "config.json");
    const mode = statSync(configPath).mode & 0o777;
    expect(mode).toBe(0o600);
    expect(readFileSync(configPath, "utf8")).toContain(token);
  });

  it("auth status models a dead token as data with exit 0", async () => {
    stubGitHub(world, () => []);
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
});

const LOGIN = ["auth", "login", "--base-url", BASE_URL, "--json"];
const VERSION_ROUTE = {
  method: "GET",
  path: "/api/version",
  body: JSON.stringify({ version: "test-version" }),
};

describe("auth login before any request", () => {
  it("rejects a non-mergebrief paste as exit 2 with empty stdout", async () => {
    const result = await runCliOffline(LOGIN, { stdin: "ghp_not_ours\n" });
    expectRefusedBeforeRequest(result, "mergebrief_");
  });

  it("an unknown flag is a usage error with exit 2", async () => {
    const result = await runCliOffline(["repos", "--bogus"]);
    expectRefusedBeforeRequest(result);
  });
});

describe("auth login profile selection and verification", () => {
  it("MERGEBRIEF_PROFILE selects the login target like --profile", async () => {
    const result = await runCliOffline(LOGIN, {
      env: { MERGEBRIEF_PROFILE: "work" },
      stdin: "mergebrief_pasted\n",
      routes: [VERSION_ROUTE],
    });
    expect(result.code).toBe(ExitCodes.OK);
    const config = readFileSync(join(result.configDir, "config.json"), "utf8");
    expect(config).toContain('"work"');
    const status = JSON.parse(result.out) as { profile: string };
    expect(status.profile).toBe("work");
    expect(result.requests).toHaveLength(1);
    expect(result.requests[0]).toMatchObject({
      path: VERSION_ROUTE.path,
      headers: { authorization: "Bearer mergebrief_pasted" },
    });
  });

  it("login verifies the PASTED token, not the MERGEBRIEF_TOKEN override", async () => {
    const result = await runCliOffline(LOGIN, {
      env: { MERGEBRIEF_TOKEN: "mergebrief_live" },
      stdin: "mergebrief_bogus_paste\n",
      routes: [
        {
          ...VERSION_ROUTE,
          status: 401,
          body: JSON.stringify({ error: "unauthorized" }),
        },
      ],
    });
    expect(result.code).toBe(ExitCodes.OK);
    const status = JSON.parse(result.out) as {
      server: { authenticated: boolean | null };
    };
    expect(status.server.authenticated).toBe(false);
    expect(result.requests).toHaveLength(1);
    expect(result.requests[0]).toMatchObject({
      path: VERSION_ROUTE.path,
      headers: { authorization: "Bearer mergebrief_bogus_paste" },
    });
  });
});
