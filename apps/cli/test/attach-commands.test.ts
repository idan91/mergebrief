// `draft attach`: against the REAL api app the bytes ride the upload route
// with the Bearer token, the App's push is answered by the GitHub stub at
// the Git Data endpoints, and with --draft the URL lands in the held draft.
// The receipt and refusal arms run over a scripted api, pinning the three
// requests the command sends and what it prints.
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createArtifactStore,
  createTenantRepository,
  createTokenAuth,
  isInstallationId,
  isRepoId,
  isReviewerId,
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
import { BASE_URL, FIXTURE_BODY_VERSION } from "./harness/consts";
import { STUB_INSTALLATION_ID } from "./harness/github-stub";
import {
  expectRefusedBeforeRequest,
  OFFLINE_REPO_ID,
  OFFLINE_REPOS_ROUTE,
  runCliOffline,
  type OfflineRunOptions,
  type ScriptedRoute,
} from "./harness/offline";
import { runCli } from "../src/program";
import type { CliDeps } from "../src/types";

const REVIEWER_ID = 555;
const REPO_A = 42001;
const BASE_SHA = "a".repeat(40);
const HEAD_SHA = "b".repeat(40);
const SPAN = ["--base", BASE_SHA, "--head", HEAD_SHA];
const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00,
]);
const BRANCH_URL_PATTERN =
  /^https:\/\/github\.com\/octo\/hello\/blob\/mergebrief\/attachments\/[0-9a-f-]{36}\.png\?raw=true$/;
const SPAN_QUERY = `base=${BASE_SHA}&head=${HEAD_SHA}`;
const PULL_PATH = `/api/repos/${OFFLINE_REPO_ID}/pulls/7`;
const SESSION_PATH = `${PULL_PATH}/session?${SPAN_QUERY}`;
const UPLOAD_PATH = `${PULL_PATH}/attachments`;
const DRAFT_ID = "5";
const DRAFT_PATH = `${PULL_PATH}/session/comments/${DRAFT_ID}?${SPAN_QUERY}`;
const IMAGE_PATH = "/shots/shot.png";
const BRANCH_URL = "https://github.com/octo/hello/blob/x/a.png?raw=true";

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
  installationId: brand(isInstallationId, STUB_INSTALLATION_ID),
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

/** The gate's reads, the App token mint, and an absent branch that the push creates. */
function stubGitHub(world: CliApiHarness): void {
  world.github.serve((url) => {
    const { pathname } = new URL(url);
    if (url.includes("/user/installations/") && url.includes("/repositories")) {
      return jsonResponse({
        total_count: 1,
        repositories: [{ id: REPO_A, full_name: "octo/hello" }],
      });
    }
    if (/\/repositories\/\d+$/.test(pathname)) {
      return jsonResponse({
        id: REPO_A,
        full_name: "octo/hello",
        private: true,
      });
    }
    if (pathname.endsWith("/access_tokens")) {
      return jsonResponse(
        { token: "ghs_installation_token", expires_at: "2099-01-01T00:00:00Z" },
        201,
      );
    }
    if (pathname.includes("/git/ref/")) {
      return jsonResponse({ message: "Not Found" }, 404);
    }
    if (pathname.endsWith("/git/blobs")) {
      return jsonResponse({ sha: "blob1" }, 201);
    }
    if (pathname.endsWith("/git/trees")) {
      return jsonResponse({ sha: "tree1" }, 201);
    }
    if (pathname.endsWith("/git/commits")) {
      return jsonResponse({ sha: "commit1", tree: { sha: "tree1" } }, 201);
    }
    if (pathname.endsWith("/git/refs")) {
      return jsonResponse({ ref: "refs/heads/mergebrief/attachments" }, 201);
    }
    return jsonResponse({ message: "unexpected endpoint" }, 404);
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readReceiptField(out: string, field: string): string {
  const parsed: unknown = JSON.parse(out);
  const value = isRecord(parsed) ? parsed[field] : undefined;
  if (typeof value !== "string") {
    throw new Error(`no ${field} in receipt: ${out}`);
  }
  return value;
}

describe("draft attach over the real api app", () => {
  let world: CliApiHarness;
  let harness: PgliteHarness;
  let kp: KeyProvider;
  let appFetch: CliDeps["fetch"];
  let configDir: string;
  let cacheDir: string;
  let imagePath: string;

  beforeEach(async () => {
    world = await startCliApiHarness();
    harness = world.harness;
    kp = world.keyProvider;
    appFetch = world.fetch;
    configDir = mkdtempSync(join(tmpdir(), "mb-config-"));
    cacheDir = mkdtempSync(join(tmpdir(), "mb-cache-"));
    imagePath = join(mkdtempSync(join(tmpdir(), "mb-shot-")), "shot.png");
    writeFileSync(imagePath, PNG_BYTES);
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

  /** PR + brief + a materialized session for the reviewer. */
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
      body: "{}",
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
      readBinaryFile: (path) => {
        if (path === imagePath) {
          return PNG_BYTES;
        }
        throw new Error(`unexpected read: ${path}`);
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

  it("posts the bytes and prints the branch url receipt verbatim", async () => {
    await seedSessionedPr(harness.handle);
    await login();

    const result = await run(["draft", "attach", "7", imagePath, "--json"]);

    expect(result.err).toEqual([]);
    expect(result.code).toBe(ExitCodes.OK);
    expect(readReceiptField(result.out, "url")).toMatch(BRANCH_URL_PATTERN);
    const gitCalls = world.github.requested.filter((path) =>
      path.includes("/git/"),
    );
    expect(gitCalls.map((path) => path.split("?")[0])).toEqual([
      "/repos/octo/hello/git/blobs",
      "/repos/octo/hello/git/ref/heads%2Fmergebrief%2Fattachments",
      "/repos/octo/hello/git/trees",
      "/repos/octo/hello/git/commits",
      "/repos/octo/hello/git/refs",
    ]);
  });

  it("appends the image to a held draft with --draft", async () => {
    await seedSessionedPr(harness.handle);
    await login();
    const created = await run([
      "draft",
      "create",
      "7",
      "--file",
      "src/a.ts",
      "--start",
      "10",
      "--end",
      "12",
      "--body",
      "tighten this",
      ...SPAN,
      "--json",
    ]);
    expect(created.code).toBe(ExitCodes.OK);
    const draftId = readReceiptField(created.out, "draftId");

    const attached = await run([
      "draft",
      "attach",
      "7",
      imagePath,
      "--draft",
      draftId,
      ...SPAN,
      "--json",
    ]);

    expect(attached.code).toBe(ExitCodes.OK);
    const url = readReceiptField(attached.out, "url");
    const session = await run(["session", "7", ...SPAN, "--json"]);
    expect(session.out).toContain(`tighten this\\n\\n![Image](${url})`);
  });
});

/** The session `draft attach --draft` reads, holding the drafts given. */
function stubSessionRoute(
  drafts: readonly { id: string; body: string }[],
): ScriptedRoute {
  return {
    method: "GET",
    path: SESSION_PATH,
    body: JSON.stringify({ draftComments: drafts }),
  };
}

function stubUploadRoute(receipt: string): ScriptedRoute {
  return { method: "POST", path: UPLOAD_PATH, status: 201, body: receipt };
}

function makeAttachOptions(
  routes: readonly ScriptedRoute[],
): OfflineRunOptions {
  return {
    routes: [OFFLINE_REPOS_ROUTE, ...routes],
    files: { [IMAGE_PATH]: PNG_BYTES },
  };
}

const HELD_DRAFT = { id: DRAFT_ID, body: "tighten this" };
const ATTACH_TO_DRAFT = [
  "draft",
  "attach",
  "7",
  IMAGE_PATH,
  "--draft",
  DRAFT_ID,
  ...SPAN,
  "--json",
];

describe("draft attach over a scripted api", () => {
  it("posts the bytes under their media type after reading the draft", async () => {
    const receipt = JSON.stringify({ url: BRANCH_URL, size: 9 });
    const result = await runCliOffline(
      ATTACH_TO_DRAFT,
      makeAttachOptions([
        stubSessionRoute([HELD_DRAFT]),
        stubUploadRoute(receipt),
        { method: "PATCH", path: DRAFT_PATH },
      ]),
    );

    expect(result.err).toEqual([]);
    expect(result.code).toBe(ExitCodes.OK);
    expect(result.out).toBe(receipt);
    expect(result.requests.map((request) => request.method)).toEqual([
      "GET",
      "GET",
      "POST",
      "GET",
      "PATCH",
    ]);
    expect(result.requests[2]).toMatchObject({
      path: UPLOAD_PATH,
      headers: { "content-type": "image/png" },
      body: PNG_BYTES,
    });
    expect(result.requests[4]).toMatchObject({
      path: DRAFT_PATH,
      body: JSON.stringify({
        body: `tighten this\n\n![Image](${BRANCH_URL})`,
      }),
    });
  });

  it("an append the server refuses still prints the image url", async () => {
    const result = await runCliOffline(
      ATTACH_TO_DRAFT,
      makeAttachOptions([
        stubSessionRoute([HELD_DRAFT]),
        stubUploadRoute(JSON.stringify({ url: BRANCH_URL })),
        {
          method: "PATCH",
          path: DRAFT_PATH,
          status: 400,
          body: JSON.stringify({ error: "body too long" }),
        },
      ]),
    );

    expect(result.code).toBe(ExitCodes.SERVER_REJECTED);
    expect(result.out).toBe("");
    expect(result.err).toEqual([
      `body too long (HTTP 400); the image is at ${BRANCH_URL}`,
    ]);
    expect(
      result.requests.filter((request) => request.path === UPLOAD_PATH),
    ).toHaveLength(1);
  });

  it("refuses an upload receipt with no url, exit 1", async () => {
    const result = await runCliOffline(
      ATTACH_TO_DRAFT,
      makeAttachOptions([
        stubSessionRoute([HELD_DRAFT]),
        stubUploadRoute("{}"),
      ]),
    );

    expect(result.code).toBe(ExitCodes.GENERIC);
    expect(result.out).toBe("");
    expect(result.err).toEqual(["upload receipt carried no url"]);
    expect(
      result.requests.filter((request) => request.method === "PATCH"),
    ).toEqual([]);
  });

  it("a draft that is not held is refused before any push, exit 4", async () => {
    const result = await runCliOffline(
      ATTACH_TO_DRAFT,
      makeAttachOptions([stubSessionRoute([])]),
    );

    expect(result.code).toBe(ExitCodes.NOT_FOUND);
    expect(result.out).toBe("");
    expect(result.err).toEqual([
      `draft ${DRAFT_ID} is not held in this session`,
    ]);
    expect(
      result.requests.filter((request) => request.path === UPLOAD_PATH),
    ).toEqual([]);
  });

  it("needs the span beside --draft, exit 2", async () => {
    const result = await runCliOffline(
      ["draft", "attach", "7", IMAGE_PATH, "--draft", DRAFT_ID, "--json"],
      makeAttachOptions([]),
    );
    expectRefusedBeforeRequest(result, "--base and --head");
  });
});
