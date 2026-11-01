// GET /api/repos/:repoId/pulls/:prNumber/committed-file?source= over PGlite:
// an image committed to the gated repository, its ref split by the refs the
// viewer's token lists, its `download_url` read from the Contents API on the
// same token, then its bytes fetched from that address with no credential.
import { makeFakeGitHub, type FakeGitHub } from "github/testing";
import {
  createTenantRepository,
  type AppDatabase,
  type KeyProvider,
  type ScopeContext,
} from "persistence";
import { PrStates } from "types/pull-requests";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mutable } from "types/utils";
import { createApp, type ApiApp, type AppDeps } from "../src/index";
import type { CommittedLookupBudgetLimits } from "../src/routes/repos/pr/attachments/types";
import {
  INSTALLATION_ID,
  PR_NUMBER,
  REPO_SLUG,
  REVIEWER_ID,
  SECRET,
  brandInstallationId,
  brandRepoId,
  brandReviewerId,
  buildOperatorToken,
  createKeyProvider,
  getRequestUrl,
} from "./fixtures";
import { testLogger } from "./logging";
import {
  ROTATED_ACCESS_TOKEN,
  arrangeFakeGate,
  buildFakeAuthDeps,
  buildFakeInstallationDeps,
  type GateGitHubOptions,
} from "./reviewer-github";
import { ACCESS_TOKEN, seedSignIn } from "./sign-in";
import { registerSharedPglite } from "./shared-pglite";

vi.setConfig({ testTimeout: 10_000 });

const REPO_ID = 424242;
const OPERATOR_PAT = "ghp_OPERATOR_PAT";
const PNG_BYTES = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2];
const SVG_TEXT = '<svg xmlns="http://www.w3.org/2000/svg"></svg>';
const SOURCE = "https://github.com/octo/hello/raw/assets/brief-362/after.png";
const DOWNLOAD_URL =
  "https://raw.githubusercontent.com/octo/hello/assets/brief-362/after.png?token=RAWTOKEN";
const READ_PATH = `/api/repos/${REPO_ID}/pulls/${PR_NUMBER}/committed-file`;

const INSTALLATION: ScopeContext = {
  installationId: brandInstallationId(BigInt(INSTALLATION_ID)),
};
const OWNER: ScopeContext = {
  ownerUserId: brandReviewerId(BigInt(REVIEWER_ID)),
};

interface GitHubCall {
  readonly url: URL;
  readonly token: string;
}

type GitHubAnswer = (call: GitHubCall) => Response;

function isCommittedFileFetch(url: string): boolean {
  return (
    url.includes("/git/matching-refs/") ||
    url.includes("/contents/") ||
    url.startsWith("https://raw.githubusercontent.com/")
  );
}

function readBearer(init: RequestInit | undefined): string {
  const authorization = new Headers(init?.headers).get("authorization") ?? "";
  return authorization.replace(/^Bearer\s+/i, "");
}

function makeJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function makeBytes(bytes: Uint8Array | string): Response {
  return new Response(bytes, {
    status: 200,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

/** Branch `assets/brief-362` exists; the file's JSON names `download`; the raw host answers `bytes`. */
function answerGitHub(
  bytes: () => Response,
  download = DOWNLOAD_URL,
): GitHubAnswer {
  return ({ url }) => {
    if (url.pathname.includes("/matching-refs/heads/")) {
      return makeJsonResponse([
        { ref: "refs/heads/assets" },
        { ref: "refs/heads/assets/brief-362" },
      ]);
    }
    if (url.pathname.includes("/matching-refs/tags/")) {
      return makeJsonResponse([]);
    }
    if (url.pathname.includes("/contents/")) {
      return makeJsonResponse({ type: "file", download_url: download });
    }
    return bytes();
  };
}

function stubGitHub(
  fake: FakeGitHub,
  gate: GateGitHubOptions,
  answer: GitHubAnswer,
): GitHubCall[] {
  arrangeFakeGate(fake, gate);
  const gateFetch = globalThis.fetch;
  const calls: GitHubCall[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = getRequestUrl(input);
      if (!isCommittedFileFetch(url)) {
        return gateFetch(input, init);
      }
      const call = { url: new URL(url), token: readBearer(init) };
      calls.push(call);
      return answer(call);
    }),
  );
  return calls;
}

function listHosts(calls: readonly GitHubCall[]): string[] {
  return calls.map((call) => `${call.url.host}${call.url.pathname}`);
}

async function seedPullRequest(
  handle: AppDatabase,
  scope: ScopeContext,
): Promise<void> {
  await createTenantRepository(handle, scope).pullRequests.upsert({
    repoId: brandRepoId(BigInt(REPO_ID)),
    prNumber: PR_NUMBER,
    repoSlug: REPO_SLUG,
    state: PrStates.OPEN,
  });
}

describe("GET committed-file", () => {
  const harness = registerSharedPglite();
  let kp: KeyProvider;
  let fake: FakeGitHub;
  let cookie: string;

  beforeEach(async () => {
    kp = createKeyProvider();
    fake = makeFakeGitHub();
    ({ cookie } = await seedSignIn(harness.handle, kp));
    await seedPullRequest(harness.handle, INSTALLATION);
  });

  function makeApp(operatorToken?: string): ApiApp {
    return makeAppWithBudget(undefined, operatorToken);
  }

  function makeAppWithBudget(
    committedLookupBudget: CommittedLookupBudgetLimits | undefined,
    operatorToken?: string,
  ): ApiApp {
    const deps: Mutable<AppDeps> = {
      logger: testLogger(),
      handle: harness.handle,
      webhookSecret: SECRET,
      auth: buildFakeAuthDeps(kp, fake),
      ...buildFakeInstallationDeps(fake),
      operatorToken:
        operatorToken === undefined
          ? undefined
          : buildOperatorToken(operatorToken),
    };
    if (committedLookupBudget !== undefined) {
      deps.committedLookupBudget = committedLookupBudget;
    }
    return createApp(deps);
  }

  async function readCommittedFile(
    app: ApiApp,
    source: string,
    method = "GET",
  ): Promise<Response> {
    const query = new URLSearchParams({ source });
    return app.request(`${READ_PATH}?${query.toString()}`, {
      method,
      headers: { Cookie: `__Host-mergebrief_session=${cookie}` },
    });
  }

  it("streams the image under the sandboxed no-store headers", async () => {
    stubGitHub(
      fake,
      { repoId: REPO_ID },
      answerGitHub(() => makeBytes(new Uint8Array(PNG_BYTES))),
    );

    const response = await readCommittedFile(makeApp(), SOURCE);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-security-policy")).toBe(
      "default-src 'none'; sandbox",
    );
    expect(response.headers.get("cross-origin-resource-policy")).toBe(
      "same-origin",
    );
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(Array.from(bytes)).toEqual(PNG_BYTES);
  });

  it("splits a slashed branch on the viewer token and fetches bytes bare", async () => {
    const calls = stubGitHub(
      fake,
      { repoId: REPO_ID },
      answerGitHub(() => makeBytes(new Uint8Array(PNG_BYTES))),
    );

    await readCommittedFile(makeApp(), SOURCE);

    const contents = calls.find((call) =>
      call.url.pathname.includes("/contents/"),
    );
    expect(contents?.url.pathname).toBe("/repos/octo/hello/contents/after.png");
    expect(contents?.url.searchParams.get("ref")).toBe("assets/brief-362");
    expect(calls.map((call) => call.token)).toEqual([
      ACCESS_TOKEN,
      ACCESS_TOKEN,
      ACCESS_TOKEN,
      "",
    ]);
    expect(calls.at(-1)?.url.href).toBe(DOWNLOAD_URL);
  });

  it("reads a refs/heads address from the heads namespace only", async () => {
    const qualified =
      "https://raw.githubusercontent.com/octo/hello/refs/heads/assets/brief-362/after.png";
    const calls = stubGitHub(
      fake,
      { repoId: REPO_ID },
      answerGitHub(() => makeBytes(new Uint8Array(PNG_BYTES))),
    );

    const response = await readCommittedFile(makeApp(), qualified);

    expect(response.status).toBe(200);
    const refCalls = calls.filter((call) =>
      call.url.pathname.includes("/matching-refs/"),
    );
    expect(refCalls.map((call) => call.url.pathname)).toEqual([
      "/repos/octo/hello/git/matching-refs/heads/assets",
    ]);
    const contents = calls.find((call) =>
      call.url.pathname.includes("/contents/"),
    );
    expect(contents?.url.pathname).toBe("/repos/octo/hello/contents/after.png");
    expect(contents?.url.searchParams.get("ref")).toBe(
      "refs/heads/assets/brief-362",
    );
  });

  it("serves an svg as svg under the same sandbox", async () => {
    const svgSource = SOURCE.replace("after.png", "flow.svg");
    stubGitHub(
      fake,
      { repoId: REPO_ID },
      answerGitHub(() => makeBytes(SVG_TEXT)),
    );

    const response = await readCommittedFile(makeApp(), svgSource);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/svg+xml");
    expect(response.headers.get("content-security-policy")).toBe(
      "default-src 'none'; sandbox",
    );
  });

  it("serves a second read from the cached refs and address", async () => {
    const calls = stubGitHub(
      fake,
      { repoId: REPO_ID },
      answerGitHub(() => makeBytes(new Uint8Array(PNG_BYTES))),
    );
    const app = makeApp();

    await readCommittedFile(app, SOURCE);
    const second = await readCommittedFile(app, SOURCE);

    expect(second.status).toBe(200);
    expect(
      listHosts(calls).filter((host) => host.startsWith("api.")),
    ).toHaveLength(3);
    expect(
      calls.filter((call) => call.url.host.startsWith("raw.")),
    ).toHaveLength(2);
  });

  it("answers 404 without calling github once the viewer's budget is spent", async () => {
    const calls = stubGitHub(
      fake,
      { repoId: REPO_ID },
      answerGitHub(() => makeBytes(new Uint8Array(PNG_BYTES))),
    );
    const app = makeAppWithBudget({ maxLookups: 3, windowMs: 60_000 });

    const first = await readCommittedFile(app, SOURCE);
    const other = SOURCE.replace("after.png", "before.png");
    const second = await readCommittedFile(app, other);

    expect(first.status).toBe(200);
    expect(second.status).toBe(404);
    expect(
      listHosts(calls).filter((host) => host.startsWith("api.")),
    ).toHaveLength(3);
  });

  it("asks for a fresh download address once after a 404", async () => {
    let downloads = 0;
    const calls = stubGitHub(
      fake,
      { repoId: REPO_ID },
      answerGitHub(() => {
        downloads += 1;
        if (downloads === 1) {
          return new Response(null, { status: 404 });
        }
        return makeBytes(new Uint8Array(PNG_BYTES));
      }),
    );

    const response = await readCommittedFile(makeApp(), SOURCE);

    expect(response.status).toBe(200);
    const contentsReads = calls.filter((call) =>
      call.url.pathname.includes("/contents/"),
    );
    expect(contentsReads).toHaveLength(2);
    expect(downloads).toBe(2);
  });

  it("answers 404 when the fresh address also 404s", async () => {
    stubGitHub(
      fake,
      { repoId: REPO_ID },
      answerGitHub(() => new Response(null, { status: 404 })),
    );

    const response = await readCommittedFile(makeApp(), SOURCE);

    expect(response.status).toBe(404);
  });

  it("answers 404 for a file in another repository without calling github", async () => {
    const calls = stubGitHub(
      fake,
      { repoId: REPO_ID },
      answerGitHub(() => makeBytes(new Uint8Array(PNG_BYTES))),
    );

    const response = await readCommittedFile(
      makeApp(),
      SOURCE.replace("octo/hello", "octo/other"),
    );

    expect(response.status).toBe(404);
    expect(calls).toEqual([]);
  });

  it("matches the repository without regard to case", async () => {
    stubGitHub(
      fake,
      { repoId: REPO_ID },
      answerGitHub(() => makeBytes(new Uint8Array(PNG_BYTES))),
    );

    const response = await readCommittedFile(
      makeApp(),
      SOURCE.replace("octo/hello", "Octo/Hello"),
    );

    expect(response.status).toBe(200);
  });

  it("answers 404 for an escaping path without calling github", async () => {
    const calls = stubGitHub(
      fake,
      { repoId: REPO_ID },
      answerGitHub(() => makeBytes(new Uint8Array(PNG_BYTES))),
    );
    const app = makeApp();

    for (const source of [
      "https://github.com/octo/hello/raw/main/a%2F..%2F..%2Fx.png",
      "https://github.com/octo/hello/raw/main/a%5Cx.png",
      "https://github.com/octo/hello/raw/main/a%252Fx.png",
      "https://github.com/octo/hello/raw/main/a%00.png",
      "https://evil.example/octo/hello/raw/main/a.png",
      "",
    ]) {
      const response = await readCommittedFile(app, source);
      expect(response.status).toBe(404);
    }
    expect(calls).toEqual([]);
  });

  it("answers 404 for a non-image name without calling github", async () => {
    const calls = stubGitHub(
      fake,
      { repoId: REPO_ID },
      answerGitHub(() => makeBytes("SECRET=1")),
    );

    const response = await readCommittedFile(
      makeApp(),
      "https://github.com/octo/hello/raw/main/.env",
    );

    expect(response.status).toBe(404);
    expect(calls).toEqual([]);
  });

  it("answers 404 for a git lfs pointer under an image name", async () => {
    stubGitHub(
      fake,
      { repoId: REPO_ID },
      answerGitHub(() =>
        makeBytes("version https://git-lfs.github.com/spec/v1\n"),
      ),
    );

    const response = await readCommittedFile(makeApp(), SOURCE);

    expect(response.status).toBe(404);
  });

  it("answers 404 when github denies the file", async () => {
    stubGitHub(fake, { repoId: REPO_ID }, ({ url }) =>
      url.pathname.includes("/contents/")
        ? new Response(null, { status: 403 })
        : makeJsonResponse([]),
    );

    const response = await readCommittedFile(makeApp(), SOURCE);

    expect(response.status).toBe(404);
  });

  it("answers 404 for a download address off the raw host", async () => {
    const calls = stubGitHub(
      fake,
      { repoId: REPO_ID },
      answerGitHub(
        () => makeBytes(new Uint8Array(PNG_BYTES)),
        "https://evil.example/after.png",
      ),
    );

    const response = await readCommittedFile(makeApp(), SOURCE);

    expect(response.status).toBe(404);
    expect(calls.some((call) => call.url.host === "evil.example")).toBe(false);
  });

  it("retries once on the rotated token after a 401", async () => {
    const answer = answerGitHub(() => makeBytes(new Uint8Array(PNG_BYTES)));
    const calls = stubGitHub(fake, { repoId: REPO_ID }, (call) =>
      call.token === ACCESS_TOKEN
        ? new Response(null, { status: 401 })
        : answer(call),
    );

    const response = await readCommittedFile(makeApp(), SOURCE);

    expect(response.status).toBe(200);
    expect(calls.map((call) => call.token)).toContain(ROTATED_ACCESS_TOKEN);
  });

  it("answers a head request with the headers and no body", async () => {
    stubGitHub(
      fake,
      { repoId: REPO_ID },
      answerGitHub(() => makeBytes(new Uint8Array(PNG_BYTES))),
    );

    const response = await readCommittedFile(makeApp(), SOURCE, "HEAD");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(await response.text()).toBe("");
  });

  describe("behind an operator pass", () => {
    beforeEach(async () => {
      ({ cookie } = await seedSignIn(harness.handle, kp));
      await seedPullRequest(harness.handle, OWNER);
    });

    it("never borrows the operator token for a committed file", async () => {
      const gate = {
        repoId: REPO_ID,
        viewerStatus: 404,
        inInstallation: false,
      };
      const calls = stubGitHub(
        fake,
        gate,
        () => new Response(null, { status: 404 }),
      );

      const response = await readCommittedFile(makeApp(OPERATOR_PAT), SOURCE);

      expect(response.status).toBe(404);
      expect(new Set(calls.map((call) => call.token))).toEqual(
        new Set([ACCESS_TOKEN]),
      );
    });
  });
});
