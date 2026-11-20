// Every operation's descriptor policy, driven off the composed registry: the
// router enforces it before the handler runs, so the denial a request meets
// follows the agreed check order whatever the route's own code does.
import { tmpdir } from "node:os";
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
import { CTX, REPO_ID } from "./session/fixtures";
import { UNUSED_INSTALLATION_DEPS } from "./reviewer-github";
import { seedSignIn, seedApiToken } from "./sign-in";
import { registerSharedPglite } from "./shared-pglite";

vi.setConfig({ testTimeout: 30_000 });

const PER_PR_SEGMENT = "/pulls/:prNumber";
/** The credential's own bookkeeping, which a refused request may still touch. */
const CREDENTIAL_TABLES = [
  "audit_log",
  "auth_session",
  "github_grant",
  "api_token",
];
const QUEUE_TABLE = "graphile_worker.jobs";
const DENIED_GATE_FETCHES = [`GET /repositories/${REPO_ID}`];
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

/** Each GitHub call as `METHOD /path`, in the order the requests sent them. */
interface GitHubCalls {
  readonly sent: string[];
}

function describeCall(
  input: string | URL | Request,
  init: RequestInit | undefined,
): string {
  const method = init?.method ?? "GET";
  return `${method} ${new URL(getRequestUrl(input)).pathname}`;
}

/** The gate's two reads: the repo by id, then which installation holds it. */
function stubGitHub(stub: RepoStub): GitHubCalls {
  const calls: GitHubCalls = { sent: [] };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      calls.sent.push(describeCall(input, init));
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
  return calls;
}

/** A draft, so a refused mark-ready that still wrote would show in the row. */
async function seedDraftPullRequest(handle: AppDatabase): Promise<void> {
  await createTenantRepository(handle, CTX).pullRequests.upsert({
    repoId: brandRepoId(BigInt(REPO_ID)),
    prNumber: PR_NUMBER,
    repoSlug: REPO_SLUG,
    draft: true,
    state: PrStates.OPEN,
  });
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

/** Every table a product operation writes, each as its rows' text. */
async function readStoredWorld(): Promise<Record<string, string>> {
  const tables = await harness.raw(
    "select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' and not (table_name = any($1))",
    [CREDENTIAL_TABLES],
  );
  const names = tables.map((row) => `public.${String(row["table_name"])}`);
  const world: Record<string, string> = {};
  for (const name of [...names, QUEUE_TABLE]) {
    const rows = await harness.raw(
      `select coalesce(string_agg(t::text, '|' order by t::text), '') as rows from ${name} t`,
    );
    world[name] = String(rows[0]?.["rows"]);
  }
  return world;
}

function listChangedTables(
  before: Record<string, string>,
  after: Record<string, string>,
): string[] {
  return Object.keys(after).filter((name) => before[name] !== after[name]);
}

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

  interface RefusalSweep {
    readonly operations: readonly ProductOperationDescriptor[];
    readonly status: number;
    readonly calls: GitHubCalls;
    /** What one request sends GitHub once the gate has met this credential. */
    readonly gateCalls: readonly string[];
    readonly send: (
      descriptor: ProductOperationDescriptor,
    ) => Response | Promise<Response>;
  }

  /**
   * Each operation whose status differs from the sweep's, or that called
   * GitHub past the gate, and any table the refusals changed.
   */
  async function collectMismatches(sweep: RefusalSweep): Promise<string[]> {
    const storedBefore = await readStoredWorld();
    const [warmUp] = sweep.operations;
    if (warmUp !== undefined) {
      await sweep.send(warmUp);
    }

    const mismatches: string[] = [];
    for (const descriptor of sweep.operations) {
      const sentBefore = sweep.calls.sent.length;
      const res = await sweep.send(descriptor);
      const sent = sweep.calls.sent.slice(sentBefore);
      if (res.status !== sweep.status) {
        mismatches.push(`${descriptor.id}: ${res.status}`);
      }
      if (sent.join() !== sweep.gateCalls.join()) {
        mismatches.push(`${descriptor.id} called ${sent.join(", ")}`);
      }
    }

    const changed = listChangedTables(storedBefore, await readStoredWorld());
    if (changed.length > 0) {
      mismatches.push(`rows changed in ${changed.join(", ")}`);
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

  it("answers every operation 401 signed-out without a credential", async () => {
    const calls = stubGitHub({ reach: RepoReaches.INSTALLATION, push: true });
    await seedDraftPullRequest(harness.handle);
    const storedBefore = await readStoredWorld();
    const withLocalBriefs = createApp({
      logger: testLogger(),
      handle: harness.handle,
      webhookSecret: SECRET,
      auth: buildAuthDeps(kp),
      localBriefsDir: tmpdir(),
      ...UNUSED_INSTALLATION_DEPS,
    });

    const operations = listOperations(() => true);
    const answers: string[] = [];
    for (const descriptor of operations) {
      const { method, path } = buildOperationRequest(descriptor);
      const res = await withLocalBriefs.request(path, {
        method,
        headers: SAME_ORIGIN_HEADERS,
      });
      const body = (await res.json()) as { code?: string };
      const cacheControl = res.headers.get("cache-control");
      answers.push(
        `${descriptor.id}: ${res.status} ${body.code ?? ""} ${cacheControl}`,
      );
    }

    expect(answers).toEqual(
      operations.map(
        (descriptor) => `${descriptor.id}: 401 signed-out no-store`,
      ),
    );
    expect(calls.sent).toEqual([]);
    expect(await readStoredWorld()).toEqual(storedBefore);
  });

  it("answers 404 to a viewer without repo access", async () => {
    const calls = stubGitHub({ reach: RepoReaches.DENIED, push: false });
    await seedDraftPullRequest(harness.handle);
    const { cookie } = await seedSignIn(harness.handle, kp);

    const mismatches = await collectMismatches({
      operations: listOperations(isPerPullRequest),
      status: 404,
      calls,
      gateCalls: DENIED_GATE_FETCHES,
      send: (descriptor) => sendAsCookie(descriptor, cookie),
    });

    expect(mismatches).toEqual([]);
  });

  it("answers 404 to a malformed pull request number", async () => {
    const calls = stubGitHub({ reach: RepoReaches.INSTALLATION, push: true });
    const { cookie } = await seedSignIn(harness.handle, kp);

    const mismatches = await collectMismatches({
      operations: listOperations(isPerPullRequest),
      status: 404,
      calls,
      gateCalls: [],
      send: (descriptor) => {
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
    });

    expect(mismatches).toEqual([]);
  });

  it("answers 404 when requiresStoredPullRequest finds no stored PR", async () => {
    const calls = stubGitHub({ reach: RepoReaches.INSTALLATION, push: true });
    const { cookie } = await seedSignIn(harness.handle, kp);

    const mismatches = await collectMismatches({
      operations: listOperations(
        (descriptor) => descriptor.requiresStoredPullRequest,
      ),
      status: 404,
      calls,
      gateCalls: [],
      send: (descriptor) => sendAsCookie(descriptor, cookie),
    });

    expect(mismatches).toEqual([]);
  });

  it("answers a malformed body on a missing row with 404, not 400", async () => {
    const calls = stubGitHub({ reach: RepoReaches.INSTALLATION, push: true });
    const { cookie } = await seedSignIn(harness.handle, kp);

    const mismatches = await collectMismatches({
      operations: listOperations(
        (descriptor) =>
          descriptor.requiresStoredPullRequest && hasBody(descriptor),
      ),
      status: 404,
      calls,
      gateCalls: [],
      send: (descriptor) => sendAsCookie(descriptor, cookie, "{not json"),
    });

    expect(mismatches).toEqual([]);
  });

  it("refuses a Bearer token on a browserSessionOnly operation with 403", async () => {
    stubGitHub({ reach: RepoReaches.INSTALLATION, push: true });
    await seedDraftPullRequest(harness.handle);
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
    const calls = stubGitHub({ reach: RepoReaches.OWNER, push: true });
    await seedUrlRow(harness.handle);
    const { cookie } = await seedSignIn(harness.handle, kp);

    const mismatches = await collectMismatches({
      operations: listOperations(
        (descriptor) => descriptor.requiresInstallation,
      ),
      status: 404,
      calls,
      gateCalls: [],
      send: (descriptor) => sendAsCookie(descriptor, cookie, "{not json"),
    });

    expect(mismatches).toEqual([]);
  });

  it("answers 404 to requiresPushAccess for a viewer without push", async () => {
    const calls = stubGitHub({ reach: RepoReaches.INSTALLATION, push: false });
    await seedDraftPullRequest(harness.handle);
    const { cookie } = await seedSignIn(harness.handle, kp);

    const mismatches = await collectMismatches({
      operations: listOperations((descriptor) => descriptor.requiresPushAccess),
      status: 404,
      calls,
      gateCalls: [],
      send: (descriptor) => sendAsCookie(descriptor, cookie),
    });

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
