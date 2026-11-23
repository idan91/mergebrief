// Surface-closeout tests: `generate` (URL-box generation, no confirm prompt)
// and `collaborators` (push-gated roster passthrough) against the REAL api
// app, in one world.
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
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
import { runCli } from "../src/program";
import type { CliDeps } from "../src/types";
import { AccessLevels } from "types/access-levels";

const REVIEWER_ID = 555;
const REPO_A = 42001;
const HEAD_SHA = "b".repeat(40);

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

/** GitHub REST stub; the repo-by-id read carries push permission. */
function stubGitHub(world: CliApiHarness): void {
  world.github.serve((url) => {
    if (url.includes("/user/installations/") && url.includes("/repositories")) {
      return jsonResponse({
        total_count: 1,
        repositories: [{ id: REPO_A, full_name: "octo/hello" }],
      });
    }
    if (url.includes("/repos/octo/hello/pulls/7")) {
      return jsonResponse({
        head: { sha: HEAD_SHA },
        base: {
          sha: "c".repeat(40),
          repo: { id: REPO_A, full_name: "octo/hello" },
        },
        state: "open",
        draft: false,
        merged: false,
        labels: [],
        title: "Add thing",
        body: "",
        html_url: "https://github.com/octo/hello/pull/7",
        commits: 3,
        user: { login: "octocat" },
        closed_at: null,
        updated_at: "2026-10-01T10:00:00Z",
        created_at: "2026-09-01T08:00:00Z",
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
    // The roster now travels the real path: the API mints an installation
    // token and asks GitHub's GraphQL, so the stub answers in GitHub's own
    // shapes rather than short-circuiting the port.
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
            collaborators: {
              pageInfo: { hasNextPage: false, endCursor: null },
              nodes: [
                {
                  login: "octocat",
                  name: null,
                  avatarUrl: "https://avatars.example/octocat",
                },
              ],
            },
          },
        },
      });
    }
    return jsonResponse({ message: "unexpected endpoint" }, 404);
  });
}

const ROSTER = {
  collaborators: [
    { login: "octocat", avatarUrl: "https://avatars.example/octocat" },
  ],
  hasMore: false,
};

describe("generate + collaborators over the real api app", () => {
  let world: CliApiHarness;
  let harness: PgliteHarness;
  let kp: KeyProvider;
  let appFetch: CliDeps["fetch"];
  let configDir: string;
  let cacheDir: string;

  beforeEach(async () => {
    configDir = mkdtempSync(join(tmpdir(), "mb-config-"));
    cacheDir = mkdtempSync(join(tmpdir(), "mb-cache-"));
    const configPath = join(configDir, "mergebrief.config.yaml");
    writeFileSync(
      configPath,
      `allowed:\n  users:\n    - ${String(REVIEWER_ID)}\n`,
    );
    world = await startCliApiHarness({ configPath });
    harness = world.harness;
    kp = world.keyProvider;
    appFetch = world.fetch;
    stubGitHub(world);
  });

  afterEach(async () => {
    await world.close();
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

  it("generate and collaborators relay their receipts verbatim", async () => {
    await login();
    const generated = await run([
      "generate",
      "https://github.com/octo/hello/pull/7",
      "--json",
    ]);
    expect(generated.err).toEqual([]);
    expect(generated.code).toBe(ExitCodes.OK);
    const parsed: unknown = JSON.parse(generated.out);
    if (typeof parsed !== "object" || parsed === null) {
      throw new Error(`unexpected receipt: ${generated.out}`);
    }
    expect(typeof Reflect.get(parsed, "repoId")).toBe("string");
    expect(typeof Reflect.get(parsed, "prNumber")).toBe("number");

    const roster = await run(["collaborators", "--json"]);
    expect(roster.err).toEqual([]);
    expect(roster.code).toBe(ExitCodes.OK);
    expect(JSON.parse(roster.out)).toEqual(ROSTER);
  });
});
