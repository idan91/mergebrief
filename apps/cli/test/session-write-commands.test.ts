// Session-write command tests against the REAL api app: draft CRUD and
// chunk-read, payload plumbing with convenience flags XOR -F, the span
// requirement firing before target resolution, receipt passthrough, and the
// relay posture on refusals the server owns.
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
  WriteClassifications,
  type AppDatabase,
  type KeyProvider,
  type ReviewerId,
  type TenantContext,
} from "persistence";
import { PrStates } from "types/pull-requests";
import type { PgliteHarness } from "persistence/testing";
import { CommentAnchorKinds } from "types/comments";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ExitCodes } from "../src/exit";
import {
  buildCreateDraftPayload,
  buildReanchorPayload,
} from "../src/commands/session-write/utils";
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
      body: "{}",
    });
    if (!brief.ok) throw new Error("brief seed failed");
    const session = await repo.reviewSessions.writeToSession(
      {
        briefId: brief.value.id,
        reviewerId: REVIEWER,
        brief: async () => ({ groupIds: [], flags: [], filePaths: [] }),
      },
      () => Promise.resolve(),
    );
    if (!session.ok) throw new Error("session seed failed");
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
        if (stdin === undefined) throw new Error("stdin not expected");
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

  it("draft create with flags posts with side new and a verbatim receipt", async () => {
    await seedSessionedPr(harness.handle);
    await login();
    const result = await run([
      "draft",
      "create",
      "7",
      ...CREATE_FLAGS,
      ...SPAN,
      "--json",
    ]);
    expect(result.err).toEqual([]);
    expect(result.code).toBe(ExitCodes.OK);
    expect(draftIdOf(result.out)).toMatch(/^\d+$/);
  });

  it("draft create --start-side crosses sides; the session echoes it", async () => {
    await seedSessionedPr(harness.handle);
    await login();
    const result = await run([
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
    expect(result.err).toEqual([]);
    expect(result.code).toBe(ExitCodes.OK);
    const session = await run(["session", "7", ...SPAN, "--json"]);
    expect(session.out).toContain('"startSide":"old"');
  });

  it("draft create rejects -F mixed with --start-side, exit 2", async () => {
    await seedSessionedPr(harness.handle);
    await login();
    const result = await run(
      ["draft", "create", "7", "-F", "-", "--start-side", "old", ...SPAN],
      JSON.stringify({}),
    );
    expect(result.code).toBe(ExitCodes.USAGE);
    expect(result.err.join("")).toContain("mutually exclusive");
  });

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
    ).toThrow(/only one of --start\/--end/);
  });

  it("buildCreateDraftPayload rejects --file mixed with only --end", () => {
    expect(() =>
      buildCreateDraftPayload({
        file: "src/a.ts",
        end: "12",
        body: "on the file",
      }),
    ).toThrow(/only one of --start\/--end/);
  });

  it("buildCreateDraftPayload rejects --file mixed with --side", () => {
    expect(() =>
      buildCreateDraftPayload({
        file: "src/a.ts",
        side: "new",
        body: "on the file",
      }),
    ).toThrow(/cannot take --side or --start-side/);
  });

  it("buildReanchorPayload converts a Line comment onto a file", () => {
    expect(buildReanchorPayload({ file: "src/a.ts" })).toEqual({
      kind: CommentAnchorKinds.FILE,
      filePath: "src/a.ts",
    });
  });

  it("draft create -F - takes the full payload from stdin", async () => {
    await seedSessionedPr(harness.handle);
    await login();
    const payload = JSON.stringify({
      filePath: "src/a.ts",
      side: "old",
      startLine: 3,
      endLine: 4,
      body: "why was this removed?",
    });
    const result = await run(
      ["draft", "create", "7", "-F", "-", ...SPAN, "--json"],
      payload,
    );
    expect(result.err).toEqual([]);
    expect(result.code).toBe(ExitCodes.OK);
    expect(draftIdOf(result.out)).toMatch(/^\d+$/);
  });

  it("a -F payload reaches the server untouched, no side default injected", async () => {
    await seedSessionedPr(harness.handle);
    await login();
    const payload = JSON.stringify({
      filePath: "src/a.ts",
      side: "old",
      startLine: 3,
      endLine: 4,
      body: "why was this removed?",
    });
    const created = await run(
      ["draft", "create", "7", "-F", "-", ...SPAN, "--json"],
      payload,
    );
    expect(created.code).toBe(ExitCodes.OK);
    const session = await run(["session", "7", ...SPAN, "--json"]);
    expect(session.code).toBe(ExitCodes.OK);
    expect(session.out).toContain('"side":"old"');
    expect(session.out).not.toContain('"side":"new"');
  });

  it("draft create -F relays a File comment for the server", async () => {
    await seedSessionedPr(harness.handle);
    await login();
    const payload = JSON.stringify({
      kind: CommentAnchorKinds.FILE,
      filePath: "src/a.ts",
      body: "on the file",
    });
    const result = await run(
      ["draft", "create", "7", "-F", "-", ...SPAN, "--json"],
      payload,
    );
    expect(result.err).toEqual([]);
    expect(result.code).toBe(ExitCodes.OK);
    const session = await run(["session", "7", ...SPAN, "--json"]);
    expect(session.out).toContain('"kind":"file"');
  });

  it("draft reanchor rejects -F mixed with anchor flags, exit 2", async () => {
    await seedSessionedPr(harness.handle);
    await login();
    const result = await run(
      [
        "draft",
        "reanchor",
        "7",
        "1",
        "-F",
        "-",
        "--start",
        "5",
        ...SPAN,
        "--json",
      ],
      "{}",
    );
    expect(result.code).toBe(ExitCodes.USAGE);
    expect(result.out).toBe("");
    expect(result.err[0]).toContain("mutually exclusive");
  });

  it("draft create --start 0 exits 2, positive integers only", async () => {
    await seedSessionedPr(harness.handle);
    await login();
    const result = await run([
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
    expect(result.code).toBe(ExitCodes.USAGE);
    expect(result.out).toBe("");
    expect(result.err[0]).toContain("--start");
  });

  it("draft create --file without a span stores a File comment", async () => {
    await seedSessionedPr(harness.handle);
    await login();
    const result = await run([
      "draft",
      "create",
      "7",
      "--file",
      "src/a.ts",
      "--body",
      "on the file",
      ...SPAN,
      "--json",
    ]);
    expect(result.err).toEqual([]);
    expect(result.code).toBe(ExitCodes.OK);
    const session = await run(["session", "7", ...SPAN, "--json"]);
    expect(session.out).toContain('"kind":"file"');
    expect(session.out).toContain('"filePath":"src/a.ts"');
    expect(session.out).not.toContain('"startLine"');
  });

  it("draft create --file with only --start exits 2 before HTTP", async () => {
    await seedSessionedPr(harness.handle);
    await login();
    const result = await run([
      "draft",
      "create",
      "7",
      "--file",
      "src/a.ts",
      "--start",
      "10",
      "--body",
      "on the file",
      ...SPAN,
      "--json",
    ]);
    expect(result.code).toBe(ExitCodes.USAGE);
    expect(result.out).toBe("");
    expect(result.err[0]).toContain("only one of --start/--end");
  });

  it("draft create --file with only --end exits 2 before HTTP", async () => {
    await seedSessionedPr(harness.handle);
    await login();
    const result = await run([
      "draft",
      "create",
      "7",
      "--file",
      "src/a.ts",
      "--end",
      "12",
      "--body",
      "on the file",
      ...SPAN,
      "--json",
    ]);
    expect(result.code).toBe(ExitCodes.USAGE);
    expect(result.out).toBe("");
    expect(result.err[0]).toContain("only one of --start/--end");
  });

  it("draft create --file with --side and no span exits 2", async () => {
    await seedSessionedPr(harness.handle);
    await login();
    const result = await run([
      "draft",
      "create",
      "7",
      "--file",
      "src/a.ts",
      "--side",
      "new",
      "--body",
      "on the file",
      ...SPAN,
      "--json",
    ]);
    expect(result.code).toBe(ExitCodes.USAGE);
    expect(result.out).toBe("");
    expect(result.err[0]).toContain("cannot take --side or --start-side");
  });

  it("draft create rejects -F mixed with convenience flags, exit 2", async () => {
    await seedSessionedPr(harness.handle);
    await login();
    const result = await run(
      ["draft", "create", "7", "-F", "-", "--body", "x", ...SPAN, "--json"],
      "{}",
    );
    expect(result.code).toBe(ExitCodes.USAGE);
    expect(result.out).toBe("");
    expect(result.err).toHaveLength(1);
    expect(result.err[0]).toContain("mutually exclusive");
  });

  it("draft create without the span exits 2 before any target resolution", async () => {
    await login();
    const token = await seedToken();
    const requested: string[] = [];
    const out: string[] = [];
    const err: string[] = [];
    const recordingFetch: CliDeps["fetch"] = async (input, init) => {
      requested.push(input);
      return appFetch(input, init);
    };
    const code = await runCli(
      ["draft", "create", "7", ...CREATE_FLAGS, "--json"],
      {
        fetch: recordingFetch,
        env: { MERGEBRIEF_TOKEN: token },
        configDir,
        cacheDir,
        stdout: (t) => out.push(t),
        stderr: (l) => err.push(l),
        readStdin: async () => {
          throw new Error("stdin not expected");
        },
        gitOriginUrl: () => "git@github.com:nobody/nothing.git",
      },
    );
    expect(code).toBe(ExitCodes.USAGE);
    expect(out.join("")).toBe("");
    expect(err).toHaveLength(1);
    expect(err[0]).toContain("--base and --head");
    expect(requested.filter((url) => url.includes("/api/repos"))).toEqual([]);
  });

  it("draft create with a non-integer --start exits 2", async () => {
    await seedSessionedPr(harness.handle);
    await login();
    const result = await run([
      "draft",
      "create",
      "7",
      "--file",
      "src/a.ts",
      "--start",
      "ten",
      "--end",
      "12",
      "--body",
      "x",
      ...SPAN,
      "--json",
    ]);
    expect(result.code).toBe(ExitCodes.USAGE);
    expect(result.out).toBe("");
    expect(result.err).toHaveLength(1);
  });

  it("a server validation rejection relays as a self-correcting exit 5", async () => {
    await seedSessionedPr(harness.handle);
    await login();
    // Flags without a body → createDraftSchema 400s deterministically.
    const result = await run([
      "draft",
      "create",
      "7",
      "--file",
      "src/a.ts",
      "--start",
      "10",
      "--end",
      "12",
      ...SPAN,
      "--json",
    ]);
    expect(result.code).toBe(ExitCodes.SERVER_REJECTED);
    expect(result.out).toBe("");
    expect(result.err).toHaveLength(1);
  });

  it("draft update --body edits a held draft; -F form matches", async () => {
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
    const draftId = draftIdOf(created.out);

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
    expect(draftIdOf(flagged.out)).toBe(draftId);

    const filed = await run(
      ["draft", "update", "7", draftId, "-F", "-", ...SPAN, "--json"],
      JSON.stringify({ body: "even sharper" }),
    );
    expect(filed.code).toBe(ExitCodes.OK);
    expect(draftIdOf(filed.out)).toBe(draftId);
  });

  it("draft update rejects -F mixed with --body, exit 2", async () => {
    await seedSessionedPr(harness.handle);
    await login();
    const result = await run(
      [
        "draft",
        "update",
        "7",
        "1",
        "-F",
        "-",
        "--body",
        "x",
        ...SPAN,
        "--json",
      ],
      "{}",
    );
    expect(result.code).toBe(ExitCodes.USAGE);
    expect(result.out).toBe("");
    expect(result.err[0]).toContain("mutually exclusive");
  });

  it("draft reanchor relays the server's human-only refusal as exit 5", async () => {
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
    const draftId = draftIdOf(created.out);
    const result = await run([
      "draft",
      "reanchor",
      "7",
      draftId,
      "--file",
      "src/a.ts",
      "--start",
      "20",
      "--end",
      "22",
      ...SPAN,
      "--json",
    ]);
    expect(result.code).toBe(ExitCodes.SERVER_REJECTED);
    expect(result.out).toBe("");
    expect(result.err).toHaveLength(1);
    expect(result.err[0]).toContain("403");
  });

  it("draft delete relays the server's human-only refusal as exit 5", async () => {
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
    const draftId = draftIdOf(created.out);
    const result = await run([
      "draft",
      "delete",
      "7",
      draftId,
      ...SPAN,
      "--json",
    ]);
    expect(result.code).toBe(ExitCodes.SERVER_REJECTED);
    expect(result.out).toBe("");
    expect(result.err).toHaveLength(1);
    expect(result.err[0]).toContain("403");
  });

  it("chunk-read marks read by default and --unread flips it", async () => {
    await seedSessionedPr(harness.handle);
    await login();
    const marked = await run(["chunk-read", "7", "chunk-1", ...SPAN, "--json"]);
    expect(marked.err).toEqual([]);
    expect(marked.code).toBe(ExitCodes.OK);
    expect(JSON.parse(marked.out)).toEqual({ chunkId: "chunk-1", read: true });

    const cleared = await run([
      "chunk-read",
      "7",
      "chunk-1",
      "--unread",
      ...SPAN,
      "--json",
    ]);
    expect(cleared.code).toBe(ExitCodes.OK);
    expect(JSON.parse(cleared.out)).toEqual({
      chunkId: "chunk-1",
      read: false,
    });
  });

  it("chunk-read rejects --read with --unread, exit 2", async () => {
    await seedSessionedPr(harness.handle);
    await login();
    const result = await run([
      "chunk-read",
      "7",
      "chunk-1",
      "--read",
      "--unread",
      ...SPAN,
      "--json",
    ]);
    expect(result.code).toBe(ExitCodes.USAGE);
    expect(result.out).toBe("");
    expect(result.err).toHaveLength(1);
  });

  it("an invalid PR number exits 2 on every session write", async () => {
    await login();
    for (const argv of [
      ["draft", "create", "x", ...CREATE_FLAGS, ...SPAN, "--json"],
      ["draft", "update", "x", "1", "--body", "b", ...SPAN, "--json"],
      [
        "draft",
        "reanchor",
        "x",
        "1",
        "--file",
        "f",
        "--start",
        "1",
        "--end",
        "2",
        ...SPAN,
        "--json",
      ],
      ["draft", "delete", "x", "1", ...SPAN, "--json"],
      ["chunk-read", "x", "chunk-1", ...SPAN, "--json"],
    ]) {
      const result = await run(argv);
      expect(result.code).toBe(ExitCodes.USAGE);
      expect(result.out).toBe("");
      expect(result.err).toHaveLength(1);
      expect(result.err[0]).toContain("PR number");
    }
  });
});
