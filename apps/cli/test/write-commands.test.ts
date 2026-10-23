// Write-command tests: payload plumbing with the mutual-exclusion rule pinned,
// the one client-side shape check, receipt passthrough byte-fidelity against
// the REAL api app for submit -F and reply --body, and the file, flag and
// stdin arms over a scripted api that pins the body each one sends.
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
  type KeyProvider,
  type ReviewerId,
  type TenantContext,
} from "persistence";
import { seedGrant, type PgliteHarness } from "persistence/testing";
import { PrStates, ReviewOutcomes, AccessLevels } from "types";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ExitCodes } from "../src/exit";
import { requireSpan } from "../src/commands/options";
import { buildSubmitPayload } from "../src/commands/write/run";
import { KEY_REF, startCliApiHarness, type CliApiHarness } from "./harness/api";
import { BASE_URL } from "./harness/consts";
import { STUB_INSTALLATION_ID } from "./harness/github-stub";
import {
  expectRefusedBeforeRequest,
  expectRelayedRequest,
  OFFLINE_REPO_ID,
  OFFLINE_REPOS_ROUTE,
  runCliOffline,
} from "./harness/offline";
import { runCli } from "../src/program";
import type { CliDeps } from "../src/types";

const INSTALLATION_ID = STUB_INSTALLATION_ID;
const REVIEWER_ID = 555;
const REPO_A = 42001;
const COMMIT = "c".repeat(40);
const BASE = "d".repeat(40);
const SPAN = ["--base", BASE, "--head", COMMIT];
const PULL_PATH = `/api/repos/${OFFLINE_REPO_ID}/pulls/7`;
const SUBMIT_PATH = `${PULL_PATH}/review?base=${BASE}&head=${COMMIT}`;
const REPLY_PATH = `${PULL_PATH}/comments/12345/replies`;
const SUBMIT_RECEIPT = JSON.stringify({
  reviewId: 987001,
  commentsDegraded: false,
  commentsFolded: 0,
  commentsTotal: 0,
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

  it("the brief span is the one client-side shape check, exit 2", () => {
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
      ).toBe(ExitCodes.USAGE);
    }
    expect(requireSpan(BASE, COMMIT)).toEqual({ base: BASE, head: COMMIT });
  });

  it("-F and flags are mutually exclusive rather than silently merged", () => {
    expect(() =>
      buildSubmitPayload({ payload: { outcome: "comment" }, body: "x" }),
    ).toThrowError(/mutually exclusive/);
  });
});

describe("write commands over the real api app", () => {
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
    world.github.serve((url) => {
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
        return jsonResponse({ id: 987001, node_id: "PRR_stub" });
      }
      // URL-only dispatch: one payload satisfies both the thread and the
      // submit mutation parsers.
      if (url.endsWith("/graphql")) {
        return jsonResponse({
          data: {
            addPullRequestReviewThread: { thread: { id: "PRRT_stub" } },
            submitPullRequestReview: { pullRequestReview: { id: "PRR_stub" } },
          },
        });
      }
      if (
        /\/pulls\/comments\/\d+\/replies$/.test(url) ||
        /\/comments\/\d+\/replies$/.test(url)
      ) {
        return jsonResponse({ id: 987002 }, 201);
      }
      return jsonResponse({ message: "unexpected endpoint" }, 404);
    });
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
    if (pr === undefined) {
      throw new Error("seedPr: pr missing");
    }
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
      usedGroupIds: [],
    });
    const written = await repo.reviewSessions.setOutcome(
      { briefId: brief.id, reviewerId: REVIEWER },
      ReviewOutcomes.COMMENT,
    );
    if (!written.ok) {
      throw new Error("seedPr: session seed failed");
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

  it("submit -F reads stdin and passes the receipt through verbatim", async () => {
    await seedPr();
    await login();
    const payload = JSON.stringify({ outcome: "comment", body: "looks fine" });
    const result = await run(
      ["submit", "7", "-F", "-", ...SPAN, "--json"],
      payload,
    );
    expect(result.err).toEqual([]);
    expect(result.code).toBe(ExitCodes.OK);
    expect(JSON.parse(result.out)).toEqual({
      reviewId: 987001,
      commentsDegraded: false,
      commentsFolded: 0,
      commentsTotal: 0,
    });
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
    expect(result.code).toBe(ExitCodes.OK);
    expect(JSON.parse(result.out)).toEqual({ commentId: 987002 });
  });
});

describe("write relays over a scripted api", () => {
  const submit = { method: "POST", path: SUBMIT_PATH, body: SUBMIT_RECEIPT };

  it("submit -F <file> reads the payload from disk", async () => {
    const payload = JSON.stringify({ outcome: "comment", body: "ok" });
    const result = await runCliOffline(
      ["submit", "7", "-F", "/payloads/review.json", ...SPAN, "--json"],
      {
        routes: [OFFLINE_REPOS_ROUTE, submit],
        files: { "/payloads/review.json": payload },
      },
    );
    expect(result.err).toEqual([]);
    expect(result.code).toBe(ExitCodes.OK);
    expect(result.out).toBe(SUBMIT_RECEIPT);
    expectRelayedRequest(result, submit, payload);
  });

  it("submit with convenience flags posts a comment-less review", async () => {
    const result = await runCliOffline(
      [
        "submit",
        "7",
        "--outcome",
        "approve",
        "--body",
        "lgtm",
        ...SPAN,
        "--json",
      ],
      { routes: [OFFLINE_REPOS_ROUTE, submit] },
    );
    expect(result.err).toEqual([]);
    expect(result.code).toBe(ExitCodes.OK);
    expect(result.out).toBe(SUBMIT_RECEIPT);
    expectRelayedRequest(
      result,
      submit,
      JSON.stringify({ outcome: "approve", body: "lgtm" }),
    );
  });

  it("reply --body-file - reads stdin and drops one trailing newline", async () => {
    const receipt = JSON.stringify({ commentId: 987002 });
    const reply = {
      method: "POST",
      path: REPLY_PATH,
      status: 201,
      body: receipt,
    };
    const result = await runCliOffline(
      ["reply", "12345", "--pr", "7", "--body-file", "-", "--json"],
      { stdin: "multi\nline body\n", routes: [OFFLINE_REPOS_ROUTE, reply] },
    );
    expect(result.err).toEqual([]);
    expect(result.code).toBe(ExitCodes.OK);
    expect(result.out).toBe(receipt);
    expectRelayedRequest(
      result,
      reply,
      JSON.stringify({ body: "multi\nline body" }),
    );
  });

  it("reply without a body source is a usage error before any request", async () => {
    const result = await runCliOffline([
      "reply",
      "12345",
      "--pr",
      "7",
      "--json",
    ]);
    expectRefusedBeforeRequest(result, "--body");
  });
});
