// Disposition command tests against the REAL api app. Risk ops pin the -F
// requirement, the --reason mutual exclusion and the human-only relay; the rest
// pin receipts and the span versus no-span split. The GitHub GraphQL boundary is
// stubbed at global fetch, following the api test pattern.
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
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
  createTokenAuth,
  type AppDatabase,
  type KeyProvider,
  type ReviewerId,
  type TenantContext,
} from "persistence";
import { PrStates, ReviewOutcomes, AccessLevels } from "types";
import type { PgliteHarness } from "persistence/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ExitCodes } from "../src/exit";
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
const SPAN = ["--base", BASE_SHA, "--head", HEAD_SHA];
const ROOT_COMMENT_ID = 12345;
const THREAD_NODE_ID = "PRRT_thread1";

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

/** One review thread whose root comment is `ROOT_COMMENT_ID`, unresolved. */
function threadWalkPage(): unknown {
  return {
    repository: {
      pullRequest: {
        reviewThreads: {
          pageInfo: { hasNextPage: false, endCursor: null },
          nodes: [
            {
              id: THREAD_NODE_ID,
              isResolved: false,
              comments: {
                nodes: [{ fullDatabaseId: String(ROOT_COMMENT_ID) }],
              },
            },
          ],
        },
      },
    },
  };
}

/**
 * GitHub stub: the gate's REST endpoints plus a scripted GraphQL sequence
 * (each POST /graphql answers the next response in order).
 */
function stubGitHub(
  world: CliApiHarness,
  graphql: readonly unknown[] = [],
): void {
  let graphqlCall = 0;
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
    if (url.endsWith("/graphql")) {
      const data = graphql[graphqlCall];
      graphqlCall += 1;
      if (data === undefined) {
        return jsonResponse({ data: null, errors: [{ message: "boom" }] });
      }
      return jsonResponse({ data });
    }
    return jsonResponse({ message: "unexpected endpoint" }, 404);
  });
}

describe("disposition commands over the real api app", () => {
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
    if (!sealedAccess.ok || !sealedRefresh.ok) {
      throw new Error("seed encrypt failed");
    }
    const grant = await createGrantAuth(harness.handle).createGrant({
      ghTokenCiphertext: sealedAccess.value,
      ghRefreshTokenCiphertext: sealedRefresh.value,
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

  /** PR + brief + a materialized session for the reviewer (the PR-1 harness). */
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
    const brief = await createArtifactStore(handle, CTX).briefs.write({
      pullRequestId: pr.id,
      baseSha: BASE_SHA,
      headSha: HEAD_SHA,
      headIndex: 1,
      commitCount: 1,
      provider: "anthropic",
      model: "claude-fable-5",
      effort: "high",
      body: JSON.stringify({ changeGroups: [{ id: "grp-1" }], chunks: [] }),
    });
    if (!brief.ok) {
      throw new Error("brief seed failed");
    }
    const session = await repo.reviewSessions.setOutcome(
      { briefId: brief.value.id, reviewerId: REVIEWER },
      ReviewOutcomes.COMMENT,
    );
    if (!session.ok) {
      throw new Error("session seed failed");
    }
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
        if (stdin === undefined) {
          throw new Error("stdin not expected");
        }
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
    expect(code).toBe(ExitCodes.OK);
  }

  const FLAGS_PAYLOAD = JSON.stringify({
    flags: [
      {
        filePath: "src/a.ts",
        attribute: "sql-injection",
        regionStart: 10,
        regionEnd: 14,
      },
    ],
  });

  it("risk dismiss without -F exits 2 with one line naming the requirement", async () => {
    await seedSessionedPr(harness.handle);
    await login();
    const result = await run([
      "risk",
      "dismiss",
      "7",
      "--reason",
      "false positive",
      ...SPAN,
      "--json",
    ]);
    expect(result.code).toBe(ExitCodes.USAGE);
    expect(result.out).toBe("");
    expect(result.err).toHaveLength(1);
    expect(result.err[0]).toContain("-F");
  });

  it("risk dismiss --reason conflicts with a payload reason, exit 2", async () => {
    await seedSessionedPr(harness.handle);
    await login();
    const withReason = JSON.stringify({
      flags: [],
      reason: "already here",
    });
    const result = await run(
      [
        "risk",
        "dismiss",
        "7",
        "-F",
        "-",
        "--reason",
        "twice",
        ...SPAN,
        "--json",
      ],
      withReason,
    );
    expect(result.code).toBe(ExitCodes.USAGE);
    expect(result.out).toBe("");
    expect(result.err).toHaveLength(1);
    expect(result.err[0]).toContain("--reason");
  });

  it("risk dismiss --reason on a non-object payload exits 2, nothing merged", async () => {
    await seedSessionedPr(harness.handle);
    await login();
    const bareArray = JSON.stringify([
      {
        filePath: "src/a.ts",
        attribute: "sql-injection",
        regionStart: 10,
        regionEnd: 14,
      },
    ]);
    const result = await run(
      [
        "risk",
        "dismiss",
        "7",
        "-F",
        "-",
        "--reason",
        "nope",
        ...SPAN,
        "--json",
      ],
      bareArray,
    );
    expect(result.code).toBe(ExitCodes.USAGE);
    expect(result.out).toBe("");
    expect(result.err).toHaveLength(1);
    expect(result.err[0]).toContain("JSON object");
  });

  it("risk ops relay the server's human-only refusal as exit 5", async () => {
    await seedSessionedPr(harness.handle);
    await login();
    const dismissed = await run(
      [
        "risk",
        "dismiss",
        "7",
        "-F",
        "-",
        "--reason",
        "false positive",
        ...SPAN,
        "--json",
      ],
      FLAGS_PAYLOAD,
    );
    expect(dismissed.code).toBe(ExitCodes.SERVER_REJECTED);
    expect(dismissed.out).toBe("");
    expect(dismissed.err).toHaveLength(1);
    expect(dismissed.err[0]).toContain("403");

    const addressed = await run(
      ["risk", "address", "7", "-F", "-", ...SPAN, "--json"],
      JSON.stringify({
        flags: [
          {
            filePath: "src/a.ts",
            attribute: "sql-injection",
            regionStart: 10,
            regionEnd: 14,
            evidence: { kind: "manual-note", ref: "checked by hand" },
          },
        ],
      }),
    );
    expect(addressed.code).toBe(ExitCodes.SERVER_REJECTED);
    expect(addressed.err[0]).toContain("403");

    const reopened = await run(
      ["risk", "reopen", "7", "-F", "-", ...SPAN, "--json"],
      FLAGS_PAYLOAD,
    );
    expect(reopened.code).toBe(ExitCodes.SERVER_REJECTED);
    expect(reopened.err[0]).toContain("403");
  });

  it("risk ops without the span exit 2 before any target resolution", async () => {
    await login();
    const token = await seedToken();
    const requested: string[] = [];
    const out: string[] = [];
    const err: string[] = [];
    const recordingFetch: CliDeps["fetch"] = async (input, init) => {
      requested.push(input);
      return appFetch(input, init);
    };
    const code = await runCli(["risk", "reopen", "7", "-F", "-", "--json"], {
      fetch: recordingFetch,
      env: { MERGEBRIEF_TOKEN: token },
      configDir,
      cacheDir,
      stdout: (t) => out.push(t),
      stderr: (l) => err.push(l),
      readStdin: async () => FLAGS_PAYLOAD,
      gitOriginUrl: () => "git@github.com:nobody/nothing.git",
    });
    expect(code).toBe(ExitCodes.USAGE);
    expect(out.join("")).toBe("");
    expect(err).toHaveLength(1);
    expect(err[0]).toContain("--base and --head");
    expect(requested.filter((url) => url.includes("/api/repos"))).toEqual([]);
  });

  it("reclassify --category writes the override and prints nothing", async () => {
    await seedSessionedPr(harness.handle);
    await login();
    const result = await run([
      "reclassify",
      "7",
      "grp-1",
      "--category",
      "bugfix",
      ...SPAN,
      "--json",
    ]);
    expect(result.err).toEqual([]);
    expect(result.code).toBe(ExitCodes.OK);
    expect(result.out).toBe("");

    const session = await run(["session", "7", ...SPAN, "--json"]);
    expect(session.out).toContain(
      '"reclassifications":[{"changeGroupId":"grp-1","category":"bugfix"}]',
    );
  });

  it("reclassify with an unknown category relays the 400 as exit 5", async () => {
    await seedSessionedPr(harness.handle);
    await login();
    const result = await run([
      "reclassify",
      "7",
      "grp-1",
      "--category",
      "nonsense",
      ...SPAN,
      "--json",
    ]);
    expect(result.code).toBe(ExitCodes.SERVER_REJECTED);
    expect(result.out).toBe("");
    expect(result.err).toHaveLength(1);
  });

  it("outcome sets the session intent; receipt verbatim", async () => {
    await seedSessionedPr(harness.handle);
    await login();
    const result = await run([
      "outcome",
      "7",
      "request-changes",
      ...SPAN,
      "--json",
    ]);
    expect(result.err).toEqual([]);
    expect(result.code).toBe(ExitCodes.OK);
    expect(JSON.parse(result.out)).toEqual({ outcome: "request-changes" });
  });

  it("thread resolve flips over GitHub with a verbatim receipt, no span", async () => {
    await seedSessionedPr(harness.handle);
    await login();
    stubGitHub(world, [
      threadWalkPage(),
      { resolveReviewThread: { thread: { isResolved: true } } },
    ]);
    const result = await run([
      "thread",
      "resolve",
      "7",
      String(ROOT_COMMENT_ID),
      "--json",
    ]);
    expect(result.err).toEqual([]);
    expect(result.code).toBe(ExitCodes.OK);
    expect(JSON.parse(result.out)).toEqual({
      resolved: true,
      alreadyInTargetState: false,
    });
  });

  it("thread unresolve mirrors resolve", async () => {
    await seedSessionedPr(harness.handle);
    await login();
    stubGitHub(world, [
      {
        repository: {
          pullRequest: {
            reviewThreads: {
              pageInfo: { hasNextPage: false, endCursor: null },
              nodes: [
                {
                  id: THREAD_NODE_ID,
                  isResolved: true,
                  comments: {
                    nodes: [{ fullDatabaseId: String(ROOT_COMMENT_ID) }],
                  },
                },
              ],
            },
          },
        },
      },
      { unresolveReviewThread: { thread: { isResolved: false } } },
    ]);
    const result = await run([
      "thread",
      "unresolve",
      "7",
      String(ROOT_COMMENT_ID),
      "--json",
    ]);
    expect(result.code).toBe(ExitCodes.OK);
    expect(JSON.parse(result.out)).toEqual({
      resolved: false,
      alreadyInTargetState: false,
    });
  });

  it("ready marks the PR ready with empty stdout and no span", async () => {
    await seedSessionedPr(harness.handle);
    await login();
    for (const argv of [
      ["ready", "7", "--json"],
      ["ready", "7"],
    ]) {
      stubGitHub(world, [
        { repository: { pullRequest: { id: "PR_node1", isDraft: true } } },
        { markPullRequestReadyForReview: { pullRequest: { isDraft: false } } },
      ]);
      const result = await run(argv);
      expect(result.err).toEqual([]);
      expect(result.code).toBe(ExitCodes.OK);
      expect(result.out).toBe("");
    }
  });

  it("an invalid PR number exits 2 on every disposition command", async () => {
    await login();
    for (const argv of [
      ["risk", "dismiss", "x", "-F", "-", ...SPAN, "--json"],
      ["reclassify", "x", "grp-1", "--category", "bugfix", ...SPAN, "--json"],
      ["outcome", "x", "comment", ...SPAN, "--json"],
      ["thread", "resolve", "x", "1", "--json"],
      ["ready", "x", "--json"],
    ]) {
      const result = await run(argv, FLAGS_PAYLOAD);
      expect(result.code).toBe(ExitCodes.USAGE);
      expect(result.out).toBe("");
      expect(result.err).toHaveLength(1);
      expect(result.err[0]).toContain("PR number");
    }
  });
});
