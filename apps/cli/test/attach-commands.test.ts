// `draft attach` against the REAL api app: the bytes ride the upload route
// with the Bearer token, the App's push is answered by the GitHub stub at
// the Git Data endpoints, and with --draft the URL lands in the held draft.
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createArtifactStore,
  createGrantAuth,
  createTenantRepository,
  createTokenAuth,
  encryptToken,
  isInstallationId,
  isRepoId,
  isReviewerId,
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
import { runCli } from "../src/program";
import type { CliDeps } from "../src/types";
import type { FetchLike } from "../src/client";

const REVIEWER_ID = 555;
const REPO_A = 42001;
const BASE_SHA = "a".repeat(40);
const HEAD_SHA = "b".repeat(40);
const SPAN = ["--base", BASE_SHA, "--head", HEAD_SHA];
const NOTES_BYTES = new TextEncoder().encode("not an image");
const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00,
]);
const BRANCH_URL_PATTERN =
  /^https:\/\/github\.com\/octo\/hello\/blob\/mergebrief\/attachments\/[0-9a-f-]{36}\.png\?raw=true$/;

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

/** The real app answers every call; the upload's receipt body is swapped. */
function stubUploadReceipt(fetch: FetchLike, receipt: string): FetchLike {
  return async (input, init) => {
    const response = await fetch(input, init);
    const isUpload = init?.method === "POST" && input.endsWith("/attachments");
    if (!isUpload) {
      return response;
    }
    return new Response(receipt, {
      status: response.status,
      headers: response.headers,
    });
  };
}

describe("draft attach over the real api app", () => {
  let world: CliApiHarness;
  let harness: PgliteHarness;
  let kp: KeyProvider;
  let appFetch: CliDeps["fetch"];
  let configDir: string;
  let cacheDir: string;
  let imagePath: string;
  let notesPath: string;

  beforeEach(async () => {
    world = await startCliApiHarness();
    harness = world.harness;
    kp = world.keyProvider;
    appFetch = world.fetch;
    configDir = mkdtempSync(join(tmpdir(), "mb-config-"));
    cacheDir = mkdtempSync(join(tmpdir(), "mb-cache-"));
    imagePath = join(mkdtempSync(join(tmpdir(), "mb-shot-")), "shot.png");
    writeFileSync(imagePath, PNG_BYTES);
    notesPath = join(mkdtempSync(join(tmpdir(), "mb-notes-")), "notes.txt");
    writeFileSync(notesPath, NOTES_BYTES);
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
      body: "{}",
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
        if (path === notesPath) {
          return NOTES_BYTES;
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

  it("relays the server's refusal of a non-image, exit 5, nothing pushed", async () => {
    await seedSessionedPr(harness.handle);
    await login();

    const result = await run(["draft", "attach", "7", notesPath, "--json"]);

    expect(result.code).toBe(ExitCodes.SERVER_REJECTED);
    expect(result.out).toBe("");
    expect(result.err).toHaveLength(1);
    expect(
      world.github.requested.filter((path) => path.includes("/git/")),
    ).toEqual([]);
  });

  it("an append the server refuses still prints the image url", async () => {
    await seedSessionedPr(harness.handle);
    await login();
    // A body at the cap: the image line the append adds pushes it over,
    // so the PATCH is a 400 after the push has landed.
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
      "x".repeat(65_536),
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

    expect(attached.code).toBe(ExitCodes.SERVER_REJECTED);
    expect(attached.out).toBe("");
    expect(attached.err).toHaveLength(1);
    expect(attached.err[0]).toMatch(
      /the image is at https:\/\/github\.com\/octo\/hello\/blob\/mergebrief\/attachments\/[0-9a-f-]+\.png\?raw=true$/,
    );
    expect(
      world.github.requested.filter((path) => path.includes("/git/refs")),
    ).toHaveLength(1);
  });

  async function createHeldDraft(): Promise<string> {
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
    return readReceiptField(created.out, "draftId");
  }

  it.each([
    ["no url", "{}"],
    ["a non-string url", JSON.stringify({ url: 5 })],
  ])("refuses an upload receipt with %s, exit 1", async (_label, receipt) => {
    await seedSessionedPr(harness.handle);
    await login();
    const draftId = await createHeldDraft();
    appFetch = stubUploadReceipt(world.fetch, receipt);

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

    expect(attached.code).toBe(ExitCodes.GENERIC);
    expect(attached.out).toBe("");
    expect(attached.err).toEqual(["upload receipt carried no url"]);
  });

  it("reads the url from a receipt that carries extra fields", async () => {
    await seedSessionedPr(harness.handle);
    await login();
    const draftId = await createHeldDraft();
    const url = "https://github.com/octo/hello/blob/x/a.png?raw=true";
    const receipt = JSON.stringify({ url, size: 9 });
    appFetch = stubUploadReceipt(world.fetch, receipt);

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
    expect(attached.out).toBe(receipt);
    const session = await run(["session", "7", ...SPAN, "--json"]);
    expect(session.out).toContain(`tighten this\\n\\n![Image](${url})`);
  });

  it("a draft that is not held is refused before any push, exit 4", async () => {
    await seedSessionedPr(harness.handle);
    await login();

    const result = await run([
      "draft",
      "attach",
      "7",
      imagePath,
      "--draft",
      "999",
      ...SPAN,
      "--json",
    ]);

    expect(result.code).toBe(ExitCodes.NOT_FOUND);
    expect(result.out).toBe("");
    expect(
      world.github.requested.filter((path) => path.includes("/git/")),
    ).toEqual([]);
  });

  it("needs the span beside --draft, exit 2", async () => {
    await login();

    const result = await run([
      "draft",
      "attach",
      "7",
      imagePath,
      "--draft",
      "1",
      "--json",
    ]);

    expect(result.code).toBe(ExitCodes.USAGE);
    expect(world.github.requested).toEqual([]);
  });
});
