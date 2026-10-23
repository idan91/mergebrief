// Disposition command tests. Against the REAL api app: reclassify, thread
// resolve and ready, with the GitHub GraphQL boundary stubbed at global
// fetch. Over the offline runner: the risk ops' -F requirement and --reason
// exclusion. Over a scripted api: the human-only relay with the merged
// --reason, outcome and unresolve.
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
import { ExitCodes } from "../src/exit";
import { KEY_REF, startCliApiHarness, type CliApiHarness } from "./harness/api";
import { BASE_URL } from "./harness/consts";
import { STUB_INSTALLATION_ID } from "./harness/github-stub";
import {
  expectRefusedBeforeRequest,
  expectRelayedRequest,
  HUMAN_ONLY_REFUSAL,
  OFFLINE_REPO_ID,
  OFFLINE_REPOS_ROUTE,
  runCliOffline,
} from "./harness/offline";
import { runCli } from "../src/program";
import type { CliDeps } from "../src/types";

const INSTALLATION_ID = STUB_INSTALLATION_ID;
const REVIEWER_ID = 555;
const REPO_A = 42001;
const BASE_SHA = "a".repeat(40);
const HEAD_SHA = "b".repeat(40);
const SPAN = ["--base", BASE_SHA, "--head", HEAD_SHA];
const ROOT_COMMENT_ID = 12345;
const THREAD_NODE_ID = "PRRT_thread1";
const SPAN_QUERY = `base=${BASE_SHA}&head=${HEAD_SHA}`;
const PULL_PATH = `/api/repos/${OFFLINE_REPO_ID}/pulls/7`;
const FLAG = {
  filePath: "src/a.ts",
  attribute: "sql-injection",
  regionStart: 10,
  regionEnd: 14,
};
const FLAGS_PAYLOAD = JSON.stringify({ flags: [FLAG] });
const ADDRESS_PAYLOAD = JSON.stringify({
  flags: [{ ...FLAG, evidence: { kind: "manual-note", ref: "by hand" } }],
});

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
      usedGroupIds: [],
    });
    const session = await repo.reviewSessions.setOutcome(
      { briefId: brief.id, reviewerId: REVIEWER },
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
});

describe("risk refusals before any request", () => {
  it("risk dismiss without -F exits 2 with one line naming the requirement", async () => {
    const result = await runCliOffline([
      "risk",
      "dismiss",
      "7",
      "--reason",
      "false positive",
      ...SPAN,
      "--json",
    ]);
    expectRefusedBeforeRequest(result, "-F");
  });

  it("risk dismiss --reason conflicts with a payload reason, exit 2", async () => {
    const result = await runCliOffline(
      ["risk", "dismiss", "7", "-F", "-", "--reason", "twice", ...SPAN],
      { stdin: JSON.stringify({ flags: [], reason: "already here" }) },
    );
    expectRefusedBeforeRequest(result, "--reason");
  });

  it("risk dismiss --reason on a non-object payload exits 2, nothing merged", async () => {
    const result = await runCliOffline(
      ["risk", "dismiss", "7", "-F", "-", "--reason", "nope", ...SPAN],
      { stdin: JSON.stringify([FLAG]) },
    );
    expectRefusedBeforeRequest(result, "JSON object");
  });
});

describe("disposition relays over a scripted api", () => {
  it.each([
    [
      ["risk", "dismiss", "7", "-F", "-", "--reason", "false positive"],
      FLAGS_PAYLOAD,
      JSON.stringify({ flags: [FLAG], reason: "false positive" }),
    ],
    [["risk", "address", "7", "-F", "-"], ADDRESS_PAYLOAD, ADDRESS_PAYLOAD],
    [["risk", "reopen", "7", "-F", "-"], FLAGS_PAYLOAD, FLAGS_PAYLOAD],
  ])(
    "%j relays the server's human-only refusal as exit 5",
    async (argv, stdin, sent) => {
      const route = {
        method: "POST",
        path: `${PULL_PATH}/session/risks/${argv[1]}?${SPAN_QUERY}`,
        status: 403,
        body: HUMAN_ONLY_REFUSAL,
      };
      const result = await runCliOffline([...argv, ...SPAN, "--json"], {
        stdin,
        routes: [OFFLINE_REPOS_ROUTE, route],
      });
      expect(result.code).toBe(ExitCodes.SERVER_REJECTED);
      expect(result.out).toBe("");
      expect(result.err).toHaveLength(1);
      expect(result.err[0]).toContain("403");
      expectRelayedRequest(result, route, sent);
    },
  );

  it("outcome sets the session intent; receipt verbatim", async () => {
    const receipt = JSON.stringify({ outcome: "request-changes" });
    const route = {
      method: "PUT",
      path: `${PULL_PATH}/session/outcome?${SPAN_QUERY}`,
      body: receipt,
    };
    const result = await runCliOffline(
      ["outcome", "7", "request-changes", ...SPAN, "--json"],
      { routes: [OFFLINE_REPOS_ROUTE, route] },
    );
    expect(result.err).toEqual([]);
    expect(result.code).toBe(ExitCodes.OK);
    expect(result.out).toBe(receipt);
    expectRelayedRequest(result, route, receipt);
  });

  it("thread unresolve mirrors resolve", async () => {
    const receipt = JSON.stringify({
      resolved: false,
      alreadyInTargetState: false,
    });
    const route = {
      method: "POST",
      path: `${PULL_PATH}/comments/${ROOT_COMMENT_ID}/unresolve`,
      body: receipt,
    };
    const result = await runCliOffline(
      ["thread", "unresolve", "7", String(ROOT_COMMENT_ID), "--json"],
      { routes: [OFFLINE_REPOS_ROUTE, route] },
    );
    expect(result.err).toEqual([]);
    expect(result.code).toBe(ExitCodes.OK);
    expect(result.out).toBe(receipt);
    expectRelayedRequest(result, route, undefined);
  });
});
