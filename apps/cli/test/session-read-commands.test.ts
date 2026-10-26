// Session-read command tests: passthrough byte-fidelity for the four Review
// Session reads over the REAL api app, and each span flag's usage error
// firing before any request over the offline runner.
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createArtifactStore,
  createTenantRepository,
  isInstallationId,
  isRepoId,
  isReviewerId,
  createTokenAuth,
  type AppDatabase,
  type KeyProvider,
  type ReviewerId,
  type TenantContext,
} from "persistence";
import { seedGrant, type PgliteHarness } from "persistence/testing";
import { PrStates, ReviewOutcomes, AccessLevels } from "types";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApiClient } from "../src/client";
import { ExitCodes } from "../src/exit";
import { KEY_REF, startCliApiHarness, type CliApiHarness } from "./harness/api";
import { BASE_URL, FIXTURE_BODY_VERSION } from "./harness/consts";
import { STUB_INSTALLATION_ID } from "./harness/github-stub";
import { expectRefusedBeforeRequest, runCliOffline } from "./harness/offline";
import { runCli } from "../src/program";
import type { CliDeps } from "../src/types";

const INSTALLATION_ID = STUB_INSTALLATION_ID;
const REVIEWER_ID = 555;
const REPO_A = 42001;
const BASE_SHA = "a".repeat(40);
const HEAD_SHA = "b".repeat(40);
const PREV_HEAD_SHA = "e".repeat(40);
const SPAN = ["--base", BASE_SHA, "--head", HEAD_SHA];
const SPAN_QUERY = `base=${BASE_SHA}&head=${HEAD_SHA}`;

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

/** GitHub stub: the allowed-set + repo-by-id endpoints the gate touches. */
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
    return jsonResponse({ message: "unexpected endpoint" }, 404);
  });
}

const REPO_CONFIG = JSON.stringify({ origin: "repo", files: [] });

describe("session read commands over the real api app", () => {
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
      bodyVersion: FIXTURE_BODY_VERSION,
      body: "{}",
      repoConfig: REPO_CONFIG,
      usedGroupIds: [],
    });
    const session = await repo.reviewSessions.setOutcome(
      { briefId: brief.id, reviewerId: REVIEWER },
      ReviewOutcomes.COMMENT,
    );
    if (!session.ok) {
      throw new Error("session seed failed");
    }
    await store.comparisonMarks.write({
      pullRequestId: pr.id,
      marks: { baselineSha: PREV_HEAD_SHA, headSha: HEAD_SHA, files: [] },
    });
    await store.revisionNarratives.write({
      pullRequestId: pr.id,
      briefId: brief.id,
      prevHeadSha: PREV_HEAD_SHA,
      headSha: HEAD_SHA,
      provider: "anthropic",
      model: "claude-fable-5",
      effort: "high",
      bodyVersion: FIXTURE_BODY_VERSION,
      body: JSON.stringify({ artifactKind: "narrative" }),
    });
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

  it("the four session reads are verbatim passthrough; TTY adds a newline", async () => {
    await seedSessionedPr(harness.handle);
    await login();
    const pull = `/api/repos/${REPO_A}/pulls/7`;
    const reads: [string[], string][] = [
      [["session", "7", ...SPAN], `${pull}/session?${SPAN_QUERY}`],
      [
        ["marks", "7", "--baseline", PREV_HEAD_SHA, "--head", HEAD_SHA],
        `${pull}/marks?baseline=${PREV_HEAD_SHA}&head=${HEAD_SHA}`,
      ],
      [
        ["narrative", "7", "--prev-head", PREV_HEAD_SHA, "--head", HEAD_SHA],
        `${pull}/narrative?prevHead=${PREV_HEAD_SHA}&head=${HEAD_SHA}`,
      ],
      [["context", "7", ...SPAN], `${pull}/brief-context?${SPAN_QUERY}`],
    ];
    for (const [argv, path] of reads) {
      const wire = await referenceBody(path);
      const result = await run([...argv, "--json"]);
      expect(result.err).toEqual([]);
      expect(result.code).toBe(ExitCodes.OK);
      expect(result.out).toBe(wire);
    }

    const context = await run(["context", "7", ...SPAN, "--json"]);
    expect(context.out).toContain('"repoConfig"');
    const tty = await run(["session", "7", ...SPAN]);
    expect(tty.code).toBe(ExitCodes.OK);
    const sessionWire = await referenceBody(`${pull}/session?${SPAN_QUERY}`);
    expect(tty.out).toBe(`${sessionWire}\n`);
  });
});

describe("session read span refusals before any request", () => {
  it.each([
    [["marks", "7", "--head", HEAD_SHA], "--baseline and --head"],
    [
      ["narrative", "7", "--prev-head", PREV_HEAD_SHA],
      "--prev-head and --head",
    ],
    [["context", "7"], "--base and --head"],
  ])("%j exits 2 with one line naming %s", async (argv, flags) => {
    const result = await runCliOffline([...argv, "--json"]);
    expectRefusedBeforeRequest(result, flags);
  });

  it.each([
    {
      command: "marks",
      argv: ["marks", "7", "--head", HEAD_SHA],
      pointer: "`mergebrief pr <n> --json` revisions",
    },
    {
      command: "narrative",
      argv: ["narrative", "7", "--prev-head", PREV_HEAD_SHA],
      pointer: "`mergebrief pr <n> --json` revisions",
    },
    {
      command: "context",
      argv: ["context", "7"],
      pointer: "`mergebrief pr <n> --json` baseSha/headSha",
    },
  ])(
    "points $command at the full SHAs pr --json carries",
    async ({ argv, pointer }) => {
      const result = await runCliOffline([...argv, "--json"]);
      expectRefusedBeforeRequest(result, pointer);
    },
  );
});
