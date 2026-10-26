// Session-write command tests: the flag-form drafts and chunk-read against
// the REAL api app, the payload builders as units, the refusals decided
// before any request over the offline runner, and the -F relay plus the
// human-only refusals over a scripted api.
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
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
import {
  CommentAnchorKinds,
  PrStates,
  ReviewOutcomes,
  AccessLevels,
} from "types";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ExitCodes } from "../src/exit";
import {
  buildCreateDraftPayload,
  buildReanchorPayload,
} from "../src/commands/session-write/utils";
import { KEY_REF, startCliApiHarness, type CliApiHarness } from "./harness/api";
import { BASE_URL, FIXTURE_BODY_VERSION } from "./harness/consts";
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
const SPAN_QUERY = `base=${BASE_SHA}&head=${HEAD_SHA}`;
const COMMENTS_PATH = `/api/repos/${OFFLINE_REPO_ID}/pulls/7/session/comments`;
const CREATE_FLAGS = [
  "--file",
  "src/a.ts",
  "--start",
  "10",
  "--end",
  "12",
  "--body",
  "tighten this",
];

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function draftIdOf(out: string): string {
  const parsed: unknown = JSON.parse(out);
  if (!isRecord(parsed)) {
    throw new Error(`no draftId in receipt: ${out}`);
  }
  const draftId = parsed["draftId"];
  if (typeof draftId !== "string") {
    throw new Error(`no draftId in receipt: ${out}`);
  }
  return draftId;
}

describe("session write commands over the real api app", () => {
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
      bodyVersion: FIXTURE_BODY_VERSION,
      body: JSON.stringify({
        changeGroups: [],
        chunks: [{ id: "chunk-1", file: "src/app.ts" }],
      }),
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

  it("draft create --start-side and bare --file land as the session echoes", async () => {
    await seedSessionedPr(harness.handle);
    await login();
    const crossing = await run([
      "draft",
      "create",
      "7",
      "--file",
      "src/a.ts",
      "--start-side",
      "old",
      "--start",
      "10",
      "--end",
      "12",
      "--body",
      "spans both sides",
      ...SPAN,
      "--json",
    ]);
    expect(crossing.err).toEqual([]);
    expect(crossing.code).toBe(ExitCodes.OK);
    const onFile = await run([
      "draft",
      "create",
      "7",
      "--file",
      "src/b.ts",
      "--body",
      "on the file",
      ...SPAN,
      "--json",
    ]);
    expect(onFile.err).toEqual([]);
    expect(onFile.code).toBe(ExitCodes.OK);

    const session = await run(["session", "7", ...SPAN, "--json"]);
    expect(session.out).toContain('"startSide":"old"');
    expect(session.out).toContain('"kind":"file"');
    expect(session.out).toContain('"filePath":"src/b.ts"');
    expect(session.out).toContain('"body":"on the file"');
    expect(session.out).not.toContain('"filePath":"src/b.ts","startLine"');
  });

  it("draft create with flags answers a draft id; update edits it silently", async () => {
    await seedSessionedPr(harness.handle);
    await login();
    const created = await run([
      "draft",
      "create",
      "7",
      ...CREATE_FLAGS,
      ...SPAN,
      "--json",
    ]);
    expect(created.err).toEqual([]);
    expect(created.code).toBe(ExitCodes.OK);
    const draftId = draftIdOf(created.out);
    expect(draftId).toMatch(/^\d+$/);

    const flagged = await run([
      "draft",
      "update",
      "7",
      draftId,
      "--body",
      "sharper wording",
      ...SPAN,
      "--json",
    ]);
    expect(flagged.err).toEqual([]);
    expect(flagged.code).toBe(ExitCodes.OK);
    expect(flagged.out).toBe("");

    const filed = await run(
      ["draft", "update", "7", draftId, "-F", "-", ...SPAN],
      JSON.stringify({ body: "even sharper" }),
    );
    expect(filed.err).toEqual([]);
    expect(filed.code).toBe(ExitCodes.OK);
    expect(filed.out).toBe("");

    const session = await run(["session", "7", ...SPAN, "--json"]);
    expect(session.out).toContain('"body":"even sharper"');
  });

  it("chunk-read marks read by default and --unread flips it", async () => {
    await seedSessionedPr(harness.handle);
    await login();
    const marked = await run(["chunk-read", "7", "chunk-1", ...SPAN, "--json"]);
    expect(marked.err).toEqual([]);
    expect(marked.code).toBe(ExitCodes.OK);
    expect(marked.out).toBe("");
    const afterMark = await run(["session", "7", ...SPAN, "--json"]);
    expect(JSON.parse(afterMark.out).readMarks).toEqual(["chunk-1"]);

    const cleared = await run([
      "chunk-read",
      "7",
      "chunk-1",
      "--unread",
      ...SPAN,
      "--json",
    ]);
    expect(cleared.err).toEqual([]);
    expect(cleared.code).toBe(ExitCodes.OK);
    expect(cleared.out).toBe("");
    const afterClear = await run(["session", "7", ...SPAN, "--json"]);
    expect(JSON.parse(afterClear.out).readMarks).toEqual([]);
  });
});

describe("session write payload builders", () => {
  it("buildReanchorPayload carries --start-side for a human-only reanchor", () => {
    expect(
      buildReanchorPayload({
        file: "src/a.ts",
        side: "new",
        startSide: "old",
        start: "10",
        end: "12",
      }),
    ).toEqual({
      filePath: "src/a.ts",
      side: "new",
      startSide: "old",
      startLine: 10,
      endLine: 12,
    });
  });

  it("buildCreateDraftPayload sends --file with no span as file", () => {
    expect(
      buildCreateDraftPayload({
        file: "src/a.ts",
        body: "on the file",
      }),
    ).toEqual({
      kind: CommentAnchorKinds.FILE,
      filePath: "src/a.ts",
      body: "on the file",
    });
  });

  it("buildCreateDraftPayload rejects --file mixed with a partial span", () => {
    expect(() =>
      buildCreateDraftPayload({
        file: "src/a.ts",
        start: "10",
        body: "on the file",
      }),
    ).toThrow(
      expect.objectContaining({
        code: ExitCodes.USAGE,
        message: expect.stringMatching(/only one of --start\/--end/),
      }),
    );
  });

  it("buildCreateDraftPayload rejects --file mixed with only --end", () => {
    expect(() =>
      buildCreateDraftPayload({
        file: "src/a.ts",
        end: "12",
        body: "on the file",
      }),
    ).toThrow(
      expect.objectContaining({
        code: ExitCodes.USAGE,
        message: expect.stringMatching(/only one of --start\/--end/),
      }),
    );
  });

  it("buildCreateDraftPayload rejects --file mixed with --side", () => {
    expect(() =>
      buildCreateDraftPayload({
        file: "src/a.ts",
        side: "new",
        body: "on the file",
      }),
    ).toThrow(
      expect.objectContaining({
        code: ExitCodes.USAGE,
        message: expect.stringMatching(/cannot take --side or --start-side/),
      }),
    );
  });

  it("buildReanchorPayload converts a Line comment onto a file", () => {
    expect(buildReanchorPayload({ file: "src/a.ts" })).toEqual({
      kind: CommentAnchorKinds.FILE,
      filePath: "src/a.ts",
    });
  });
});

describe("session write refusals before any request", () => {
  it.each([
    [["draft", "create", "7", "-F", "-", "--start-side", "old"]],
    [["draft", "create", "7", "-F", "-", "--body", "x"]],
    [["draft", "reanchor", "7", "1", "-F", "-", "--start", "5"]],
    [["draft", "update", "7", "1", "-F", "-", "--body", "x"]],
  ])("%j rejects -F mixed with flags, exit 2", async (argv) => {
    const result = await runCliOffline([...argv, ...SPAN], { stdin: "{}" });
    expectRefusedBeforeRequest(result, "mutually exclusive");
  });

  it("draft create --start 0 exits 2, positive integers only", async () => {
    const result = await runCliOffline([
      "draft",
      "create",
      "7",
      "--file",
      "src/a.ts",
      "--start",
      "0",
      "--end",
      "2",
      "--body",
      "x",
      ...SPAN,
      "--json",
    ]);
    expectRefusedBeforeRequest(result, "--start");
  });

  it("draft create without the span exits 2 before any target resolution", async () => {
    const result = await runCliOffline([
      "draft",
      "create",
      "7",
      ...CREATE_FLAGS,
      "--json",
    ]);
    expectRefusedBeforeRequest(result, "--base and --head");
  });

  it("chunk-read rejects --read with --unread, exit 2", async () => {
    const result = await runCliOffline([
      "chunk-read",
      "7",
      "chunk-1",
      "--read",
      "--unread",
      ...SPAN,
      "--json",
    ]);
    expectRefusedBeforeRequest(result, "--read and --unread");
  });
});

describe("session write relays over a scripted api", () => {
  it("a -F payload reaches the server untouched, no side default injected", async () => {
    const payload = JSON.stringify({
      filePath: "src/a.ts",
      side: "old",
      startLine: 3,
      endLine: 4,
      body: "why was this removed?",
    });
    const receipt = JSON.stringify({ draftId: "1" });
    const create = {
      method: "POST",
      path: `${COMMENTS_PATH}?${SPAN_QUERY}`,
      status: 201,
      body: receipt,
    };
    const result = await runCliOffline(
      ["draft", "create", "7", "-F", "-", ...SPAN, "--json"],
      { stdin: payload, routes: [OFFLINE_REPOS_ROUTE, create] },
    );
    expect(result.err).toEqual([]);
    expect(result.code).toBe(ExitCodes.OK);
    expect(result.out).toBe(receipt);
    expectRelayedRequest(result, create, payload);
  });

  it("draft reanchor relays the server's human-only refusal as exit 5", async () => {
    const reanchor = {
      method: "PUT",
      path: `${COMMENTS_PATH}/9/anchor?${SPAN_QUERY}`,
      status: 403,
      body: HUMAN_ONLY_REFUSAL,
    };
    const result = await runCliOffline(
      [
        "draft",
        "reanchor",
        "7",
        "9",
        "--file",
        "src/a.ts",
        "--start",
        "20",
        "--end",
        "22",
        ...SPAN,
        "--json",
      ],
      { routes: [OFFLINE_REPOS_ROUTE, reanchor] },
    );
    expect(result.code).toBe(ExitCodes.SERVER_REJECTED);
    expect(result.out).toBe("");
    expect(result.err).toHaveLength(1);
    expect(result.err[0]).toContain("403");
    expectRelayedRequest(
      result,
      reanchor,
      JSON.stringify({
        side: "new",
        filePath: "src/a.ts",
        startLine: 20,
        endLine: 22,
      }),
    );
  });

  it("draft delete relays the server's human-only refusal as exit 5", async () => {
    const remove = {
      method: "DELETE",
      path: `${COMMENTS_PATH}/9?${SPAN_QUERY}`,
      status: 403,
      body: HUMAN_ONLY_REFUSAL,
    };
    const result = await runCliOffline(
      ["draft", "delete", "7", "9", ...SPAN, "--json"],
      { routes: [OFFLINE_REPOS_ROUTE, remove] },
    );
    expect(result.code).toBe(ExitCodes.SERVER_REJECTED);
    expect(result.out).toBe("");
    expect(result.err).toHaveLength(1);
    expect(result.err[0]).toContain("403");
    expectRelayedRequest(result, remove, undefined);
  });
});
