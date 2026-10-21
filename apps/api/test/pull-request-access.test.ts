// Every operation's descriptor policy, driven off the composed registry: the
// router enforces it before the handler runs, so the denial a request meets
// follows the agreed check order whatever the route's own code does.
import {
  createTenantRepository,
  type AppDatabase,
  type KeyProvider,
  type ScopeContext,
} from "persistence";
import { PrStates, type ValueOf, AccessLevels } from "types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, type ApiApp } from "../src/index";
import { productOperationRegistry } from "../src/product-operations/registry";
import type { ProductOperationDescriptor } from "../src/product-operations/types";
import { testLogger } from "./logging";
import {
  PR_NUMBER,
  REPO_SLUG,
  REVIEWER_ID,
  SAME_ORIGIN_HEADERS,
  SECRET,
  answerInstallationRepositories,
  brandRepoId,
  brandReviewerId,
  buildAuthDeps,
  createKeyProvider,
  getRequestUrl,
} from "./fixtures";
import { REPO_ID, seedPullRequest } from "./session/fixtures";
import { UNUSED_INSTALLATION_DEPS } from "./reviewer-github";
import { seedSignIn, seedApiToken } from "./sign-in";
import { registerSharedPglite } from "./shared-pglite";

vi.setConfig({ testTimeout: 30_000 });

const PER_PR_SEGMENT = "/pulls/:prNumber";
const OWNER: ScopeContext = {
  ownerUserId: brandReviewerId(BigInt(REVIEWER_ID)),
};

const RepoReaches = {
  DENIED: "denied",
  INSTALLATION: "installation",
  OWNER: "owner",
} as const;
type RepoReach = ValueOf<typeof RepoReaches>;

interface RepoStub {
  readonly reach: RepoReach;
  readonly push: boolean;
}

function answerJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

/** The gate's two reads: the repo by id, then which installation holds it. */
function stubGitHub(stub: RepoStub): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request): Promise<Response> => {
      const url = getRequestUrl(input);
      const heldBy = stub.reach === RepoReaches.INSTALLATION ? [REPO_ID] : [];
      const membership = answerInstallationRepositories(url, heldBy);
      if (membership !== undefined) {
        return membership;
      }
      if (url.includes("/repositories/")) {
        if (stub.reach === RepoReaches.DENIED) {
          return answerJson({ message: "Not Found" }, 404);
        }
        return answerJson({
          id: REPO_ID,
          full_name: REPO_SLUG,
          private: true,
          permissions: { admin: stub.push, push: stub.push, pull: true },
        });
      }
      throw new Error(`unexpected fetch in the access table: ${url}`);
    }),
  );
}

async function seedUrlRow(handle: AppDatabase): Promise<void> {
  await createTenantRepository(handle, OWNER).pullRequests.upsert({
    repoId: brandRepoId(BigInt(REPO_ID)),
    prNumber: PR_NUMBER,
    repoSlug: REPO_SLUG,
    state: PrStates.OPEN,
  });
}

interface OperationRequest {
  readonly method: string;
  readonly path: string;
}

/** The endpoint with its coordinates filled; any other param is `1`. */
function buildOperationRequest(
  descriptor: ProductOperationDescriptor,
): OperationRequest {
  const [method = "", template = ""] = descriptor.endpoint.split(" ");
  const path = template
    .replace(":repoId", String(REPO_ID))
    .replace(":prNumber", String(PR_NUMBER))
    .replace(/:[A-Za-z]+/g, "1");
  return { method, path };
}

function isPerPullRequest(descriptor: ProductOperationDescriptor): boolean {
  return descriptor.endpoint.includes(PER_PR_SEGMENT);
}

function hasBody(descriptor: ProductOperationDescriptor): boolean {
  return !descriptor.endpoint.startsWith("GET ");
}

const harness = registerSharedPglite();

describe("the descriptor policy over every operation", () => {
  let kp: KeyProvider;
  let app: ApiApp;

  beforeEach(() => {
    kp = createKeyProvider();
    app = createApp({
      logger: testLogger(),
      handle: harness.handle,
      webhookSecret: SECRET,
      auth: buildAuthDeps(kp),
      ...UNUSED_INSTALLATION_DEPS,
    });
  });

  function listOperations(
    keep: (descriptor: ProductOperationDescriptor) => boolean,
  ): readonly ProductOperationDescriptor[] {
    const kept = productOperationRegistry.list().filter(keep);
    expect(kept.length).toBeGreaterThan(0);
    return kept;
  }

  async function sendAsCookie(
    descriptor: ProductOperationDescriptor,
    cookie: string,
    body?: string,
  ): Promise<Response> {
    const { method, path } = buildOperationRequest(descriptor);
    const init: RequestInit = {
      method,
      headers: {
        ...SAME_ORIGIN_HEADERS,
        "content-type": "application/json",
        Cookie: `__Host-mergebrief_session=${cookie}`,
      },
    };
    if (body !== undefined && hasBody(descriptor)) {
      init.body = body;
    }
    return app.request(path, init);
  }

  /** Each operation's status where it differs from `expected`. */
  async function collectMismatches(
    operations: readonly ProductOperationDescriptor[],
    expected: number,
    send: (
      descriptor: ProductOperationDescriptor,
    ) => Response | Promise<Response>,
  ): Promise<string[]> {
    const mismatches: string[] = [];
    for (const descriptor of operations) {
      const res = await send(descriptor);
      if (res.status !== expected) {
        mismatches.push(`${descriptor.id}: ${res.status}`);
      }
    }
    return mismatches;
  }

  it("declares a row only under a pull request", () => {
    const misplaced = listOperations(() => true)
      .filter((descriptor) => descriptor.requiresStoredPullRequest)
      .filter((descriptor) => !isPerPullRequest(descriptor))
      .map((descriptor) => descriptor.id);

    expect(misplaced).toEqual([]);
  });

  it("answers 404 to a viewer without repo access", async () => {
    stubGitHub({ reach: RepoReaches.DENIED, push: false });
    await seedPullRequest(harness.handle);
    const { cookie } = await seedSignIn(harness.handle, kp);

    const mismatches = await collectMismatches(
      listOperations(isPerPullRequest),
      404,
      (descriptor) => sendAsCookie(descriptor, cookie),
    );

    expect(mismatches).toEqual([]);
  });

  it("answers 404 to a malformed pull request number", async () => {
    stubGitHub({ reach: RepoReaches.INSTALLATION, push: true });
    const { cookie } = await seedSignIn(harness.handle, kp);

    const mismatches = await collectMismatches(
      listOperations(isPerPullRequest),
      404,
      (descriptor) => {
        const { method, path } = buildOperationRequest(descriptor);
        const malformed = path.replace(`/pulls/${PR_NUMBER}`, "/pulls/abc");
        return app.request(malformed, {
          method,
          headers: {
            ...SAME_ORIGIN_HEADERS,
            Cookie: `__Host-mergebrief_session=${cookie}`,
          },
        });
      },
    );

    expect(mismatches).toEqual([]);
  });

  it("answers 404 when requiresStoredPullRequest finds no stored PR", async () => {
    stubGitHub({ reach: RepoReaches.INSTALLATION, push: true });
    const { cookie } = await seedSignIn(harness.handle, kp);

    const mismatches = await collectMismatches(
      listOperations((descriptor) => descriptor.requiresStoredPullRequest),
      404,
      (descriptor) => sendAsCookie(descriptor, cookie),
    );

    expect(mismatches).toEqual([]);
  });

  it("answers a malformed body on a missing row with 404, not 400", async () => {
    stubGitHub({ reach: RepoReaches.INSTALLATION, push: true });
    const { cookie } = await seedSignIn(harness.handle, kp);

    const mismatches = await collectMismatches(
      listOperations(
        (descriptor) =>
          descriptor.requiresStoredPullRequest && hasBody(descriptor),
      ),
      404,
      (descriptor) => sendAsCookie(descriptor, cookie, "{not json"),
    );

    expect(mismatches).toEqual([]);
  });

  it("refuses a Bearer token on a browserSessionOnly operation with 403", async () => {
    stubGitHub({ reach: RepoReaches.INSTALLATION, push: true });
    await seedPullRequest(harness.handle);
    const bearer = await seedApiToken(
      harness.handle,
      kp,
      AccessLevels.EXTERNAL_WRITE,
    );

    const operations = listOperations(
      (descriptor) => descriptor.browserSessionOnly,
    );
    const codes: string[] = [];
    for (const descriptor of operations) {
      const { method, path } = buildOperationRequest(descriptor);
      const res = await app.request(path, {
        method,
        headers: { Authorization: `Bearer ${bearer}` },
        body: "{not json",
      });
      const body = (await res.json()) as { code?: string };
      codes.push(`${descriptor.id}: ${res.status} ${body.code ?? ""}`);
    }

    expect(codes).toEqual(
      operations.map((descriptor) => `${descriptor.id}: 403 human-only`),
    );
  });

  it("answers 404 to requiresInstallation on a repo in no Installation", async () => {
    stubGitHub({ reach: RepoReaches.OWNER, push: true });
    await seedUrlRow(harness.handle);
    const { cookie } = await seedSignIn(harness.handle, kp);

    const mismatches = await collectMismatches(
      listOperations((descriptor) => descriptor.requiresInstallation),
      404,
      (descriptor) => sendAsCookie(descriptor, cookie, "{not json"),
    );

    expect(mismatches).toEqual([]);
  });

  it("answers 404 to requiresPushAccess for a viewer without push", async () => {
    stubGitHub({ reach: RepoReaches.INSTALLATION, push: false });
    await seedPullRequest(harness.handle);
    const { cookie } = await seedSignIn(harness.handle, kp);

    const mismatches = await collectMismatches(
      listOperations((descriptor) => descriptor.requiresPushAccess),
      404,
      (descriptor) => sendAsCookie(descriptor, cookie),
    );

    expect(mismatches).toEqual([]);
  });
});

describe("the audit row's world", () => {
  let kp: KeyProvider;
  let app: ApiApp;

  beforeEach(() => {
    kp = createKeyProvider();
    app = createApp({
      logger: testLogger(),
      handle: harness.handle,
      webhookSecret: SECRET,
      auth: buildAuthDeps(kp),
      ...UNUSED_INSTALLATION_DEPS,
    });
  });

  it("records the url row's world inside an installation-held repo", async () => {
    stubGitHub({ reach: RepoReaches.INSTALLATION, push: true });
    await seedUrlRow(harness.handle);
    const { cookie } = await seedSignIn(harness.handle, kp);

    const res = await app.request(
      `/api/repos/${REPO_ID}/pulls/${PR_NUMBER}/archive`,
      {
        method: "POST",
        headers: {
          ...SAME_ORIGIN_HEADERS,
          Cookie: `__Host-mergebrief_session=${cookie}`,
        },
      },
    );

    expect(res.status).toBe(204);
    const rows = await harness.raw(
      "select operation, installation_id, source from audit_log order by id",
    );
    expect(rows).toEqual([
      { operation: "archive-pull", installation_id: null, source: "url" },
    ]);
  });
});
