// Use real signatures and schema-valid payloads over PGlite with a graphile queue stub.
// No network, model calls or real Postgres are needed at this boundary.
import { randomInt } from "node:crypto";
import { sign } from "@octokit/webhooks-methods";
import {
  createArtifactStore,
  createEnvKeyProvider,
  createIngestRoutines,
  createTenantRepository,
  createWebhookDeliveryStore,
  DELIVERY_DEDUP_TTL_MS,
  digestWebhookSignature,
  ENTRY_SYNC_MAX_ATTEMPTS,
  isPullRequestRowId,
  isRepoId,
  parseTenantContext,
  TriggerOnDemandOutcomes,
  type AppDatabase,
  type PullRequestRowId,
  type RepoId,
} from "persistence";
import { approveTestTrigger } from "persistence/testing";
import { PrStates } from "types/pull-requests";
import { AccessLevels } from "types/access-levels";
import { startTestTracing, type TestTracing } from "logging/testing";
import { FakeFailures, makeFakeGitHub, type FakeGitHub } from "github/testing";
import { beforeEach, describe, expect, it } from "vitest";
import {
  createApp,
  type ApiApp,
  type AppDeps,
  type AuthDeps,
} from "../src/index";
import { testLogger, testLogging } from "./logging";
import {
  brandInstallationId,
  brandReviewerId,
  buildAuthDeps,
  createKeyProvider,
  INSTALLATION_ID,
  KEY_REF,
  REVIEWER_ID,
  SECRET,
} from "./fixtures";
import { seedApiToken, seedSignIn } from "./sign-in";
import {
  buildFakeInstallationDeps,
  UNUSED_INSTALLATION_DEPS,
} from "./reviewer-github";
import {
  openPerTestPglite,
  registerSharedPglite,
  type SharedPglite,
} from "./shared-pglite";
import { STORED_BODY_VERSION } from "brief-core/artifact";

// Dummy auth deps: the webhook tests never exercise the OAuth/session routes,
// but `createApp` now requires the bundle. A throwaway 32-byte key keeps the
// crypto boundary constructible; nothing here triggers a token seal.
const DUMMY_AUTH: AuthDeps = buildAuthDeps(
  createEnvKeyProvider({ [KEY_REF]: Buffer.alloc(32).toString("base64") }),
);
const REPO_ID = 186853002;
const OTHER_REPO_ID = 186853003;
const REPO_OWNER_ID = 77001;
const LISTED_OWNER_DEPS = {
  allowedAccess: {
    users: new Set<bigint>(),
    accounts: new Set([BigInt(REPO_OWNER_ID)]),
  },
};
const HEAD_SHA = "ec26c3e57ca3a959ca5aad62de7213c562f8c821";
const BASE_SHA = "f95f852bd8fca8fcc58a9a2d6c842781e32a215e";
/** A `run_at` no delivery computes, so one that moved it cannot match. */
const PINNED_RUN_AT = new Date("2026-01-01T00:00:00Z");
const HOUR_MS = 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

/** Coerce a raw timestamptz cell (Date on PGlite) to epoch milliseconds. */
function epochMs(cell: unknown): number {
  if (cell instanceof Date) {
    return cell.getTime();
  }
  if (typeof cell === "string") {
    return new Date(cell).getTime();
  }
  throw new Error(`expected a timestamp cell, got ${typeof cell}`);
}

function brandRepoId(value: bigint): RepoId {
  if (!isRepoId(value)) {
    throw new Error(`test repo id failed its brand guard: ${value}`);
  }
  return value;
}

interface DeliverOptions {
  readonly secret?: string;
  readonly signature?: string;
  readonly deliveryId?: string;
}

/** The same event content under a new signature, as a second GitHub event carries. */
function makeDistinctEvent(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  return { ...payload, sender: { id: randomInt(1, 2 ** 31) } };
}

/** Sign `payload` (over the exact serialized bytes) and POST it. */
async function deliver(
  app: ApiApp,
  eventName: string,
  payload: unknown,
  options?: DeliverOptions,
): Promise<Response> {
  const body = JSON.stringify(payload);
  const signature =
    options?.signature ?? (await sign(options?.secret ?? SECRET, body));
  return app.request("/api/webhooks/github", {
    method: "POST",
    headers: {
      "x-hub-signature-256": signature,
      "x-github-event": eventName,
      "x-github-delivery": options?.deliveryId ?? "delivery-123",
      "content-type": "application/json",
    },
    body,
  });
}

// Minimal payloads satisfying github's Zod event schemas.

type RepositoryVisibility = "public" | "private" | "internal";

function makeRepository(
  repoId: number,
  visibility: RepositoryVisibility,
): Record<string, unknown> {
  return {
    id: repoId,
    full_name: "acme/widgets",
    owner: { id: REPO_OWNER_ID },
    private: visibility !== "public",
    visibility,
  };
}

function pullRequestPayload(input: {
  action: string;
  prNumber?: number;
  repoId?: number;
  merged?: boolean;
  draft?: boolean;
  authorLogin?: string | null;
  headSha?: string;
  baseSha?: string;
  /** GitHub's `pull_request.updated_at`, the late-event guard's key. */
  updatedAt?: string;
  closedAt?: string | null;
  /** GitHub's `changes` block on an `edited` event. */
  changes?: Record<string, unknown>;
  /** The author's `author_association`; `null` omits the field. */
  authorAssociation?: string | null;
  authorType?: string;
  visibility?: RepositoryVisibility;
}): Record<string, unknown> {
  const pullRequest: Record<string, unknown> = {
    title: "Update the README with new information.",
    head: { sha: input.headSha ?? HEAD_SHA },
    base: { sha: input.baseSha ?? BASE_SHA },
    draft: input.draft ?? false,
    user:
      input.authorLogin === null
        ? null
        : {
            login: input.authorLogin ?? "author-octocat",
            type: input.authorType ?? "User",
          },
  };
  if (input.authorAssociation !== null) {
    pullRequest["author_association"] =
      input.authorAssociation ?? "COLLABORATOR";
  }

  if (input.merged !== undefined) {
    pullRequest["merged"] = input.merged;
  }
  if (input.updatedAt !== undefined) {
    pullRequest["updated_at"] = input.updatedAt;
  }
  if (input.closedAt !== undefined) {
    pullRequest["closed_at"] = input.closedAt;
  }

  const payload: Record<string, unknown> = {
    action: input.action,
    number: input.prNumber ?? 2,
    installation: { id: INSTALLATION_ID },
    repository: makeRepository(
      input.repoId ?? REPO_ID,
      input.visibility ?? "public",
    ),
    pull_request: pullRequest,
  };
  if (input.changes !== undefined) {
    payload["changes"] = input.changes;
  }

  return payload;
}

function pullRequestReviewPayload(review?: {
  commitId?: string;
  submittedAt?: string;
  userType?: string;
  userId?: number;
  authorAssociation?: string;
  visibility?: RepositoryVisibility;
  /** The PR author's `author_association`, not the reviewer's. */
  pullRequestAuthorAssociation?: string;
}): Record<string, unknown> {
  return {
    action: "submitted",
    installation: { id: INSTALLATION_ID },
    repository: makeRepository(REPO_ID, review?.visibility ?? "public"),
    pull_request: {
      number: 2,
      title: "Update the README with new information.",
      head: { sha: HEAD_SHA },
      author_association:
        review?.pullRequestAuthorAssociation ?? "COLLABORATOR",
      user: { login: "author-octocat", type: "User" },
    },
    review: {
      state: "approved",
      commit_id: review?.commitId ?? HEAD_SHA,
      submitted_at: review?.submittedAt ?? "2026-07-07T12:00:00Z",
      author_association: review?.authorAssociation ?? "COLLABORATOR",
      user: {
        id: review?.userId ?? 21031067,
        login: "reviewer",
        type: review?.userType ?? "User",
      },
    },
  };
}

function installationPayload(action: string): Record<string, unknown> {
  return {
    action,
    installation: { id: INSTALLATION_ID },
    sender: { id: 21031067 },
  };
}

function installationRepositoriesPayload(input: {
  action: string;
  removedRepoIds?: number[];
}): Record<string, unknown> {
  return {
    action: input.action,
    installation: { id: INSTALLATION_ID },
    repositories_added: [],
    repositories_removed: (input.removedRepoIds ?? []).map((id) => ({ id })),
  };
}

/** Seed one open PR row directly through the tenant repository. */
async function seedPullRequest(
  harness: SharedPglite,
  repoId: bigint,
  prNumber: number,
): Promise<void> {
  const ctx = parseTenantContext({ installationId: INSTALLATION_ID });
  await createTenantRepository(harness.handle, ctx).pullRequests.upsert({
    repoId: brandRepoId(repoId),
    prNumber,
    repoSlug: "acme/widgets",
    state: PrStates.OPEN,
  });
}

async function countRows(
  harness: SharedPglite,
  table: string,
): Promise<number> {
  const rows = await harness.raw(`select count(*)::int as n from ${table}`);
  const n = rows[0]?.["n"];
  if (typeof n !== "number") {
    throw new Error(`unexpected count result for ${table}`);
  }
  return n;
}

// ---------------------------------------------------------------------------
// Suite.
// ---------------------------------------------------------------------------

const harness = registerSharedPglite();

describe("webhook deliveries by repository owner", () => {
  function buildApp(
    policy: Pick<AppDeps, "allowedAccess" | "operatorIds">,
  ): ApiApp {
    return createApp({
      logger: testLogger(),
      handle: harness.handle,
      webhookSecret: SECRET,
      auth: DUMMY_AUTH,
      ...UNUSED_INSTALLATION_DEPS,
      ...policy,
    });
  }

  async function countRuns(): Promise<number> {
    const jobs = await harness.raw("select id from graphile_worker.jobs");
    return jobs.length;
  }

  it("starts nothing on an instance with nothing configured", async () => {
    const res = await deliver(
      buildApp({}),
      "pull_request",
      pullRequestPayload({ action: "opened" }),
    );

    expect(res.status).toBe(200);
    expect(await countRuns()).toBe(0);
    expect(await harness.raw("select id from pull_request")).toEqual([]);
  });

  it("starts nothing for an owner the instance does not list", async () => {
    const closed = buildApp({
      allowedAccess: { users: new Set(), accounts: new Set([9919n]) },
    });

    const res = await deliver(
      closed,
      "pull_request",
      pullRequestPayload({ action: "synchronize" }),
    );

    expect(res.status).toBe(200);
    expect(await countRuns()).toBe(0);
  });

  it("does not count a listed user as a listed account", async () => {
    const res = await deliver(
      buildApp({
        allowedAccess: {
          users: new Set([BigInt(REPO_OWNER_ID)]),
          accounts: new Set(),
        },
      }),
      "pull_request",
      pullRequestPayload({ action: "opened" }),
    );

    expect(res.status).toBe(200);
    expect(await countRuns()).toBe(0);
  });

  it("starts a run for a listed owner", async () => {
    await deliver(
      buildApp(LISTED_OWNER_DEPS),
      "pull_request",
      pullRequestPayload({ action: "opened" }),
    );

    expect(await countRuns()).toBe(1);
  });

  it("starts a run on an Operator's personal account", async () => {
    await deliver(
      buildApp({ operatorIds: new Set([BigInt(REPO_OWNER_ID)]) }),
      "pull_request",
      pullRequestPayload({ action: "opened" }),
    );

    expect(await countRuns()).toBe(1);
  });

  it("starts nothing from a delivery that names no owner", async () => {
    const payload = pullRequestPayload({ action: "opened" });
    const repository = { ...makeRepository(REPO_ID, "private") };
    delete repository["owner"];

    await deliver(buildApp(LISTED_OWNER_DEPS), "pull_request", {
      ...payload,
      repository,
    });

    expect(await countRuns()).toBe(0);
  });

  it("runs a redelivery once the account is listed", async () => {
    const payload = pullRequestPayload({ action: "opened" });

    await deliver(buildApp({}), "pull_request", payload);
    await deliver(buildApp(LISTED_OWNER_DEPS), "pull_request", payload);

    expect(await countRuns()).toBe(1);
  });

  it("writes no checkpoint for a review from an unlisted owner", async () => {
    await deliver(
      buildApp(LISTED_OWNER_DEPS),
      "pull_request",
      pullRequestPayload({ action: "opened" }),
    );

    await deliver(
      buildApp({
        allowedAccess: { users: new Set(), accounts: new Set([9919n]) },
      }),
      "pull_request_review",
      pullRequestReviewPayload(),
    );

    expect(await harness.raw("select * from checkpoint")).toEqual([]);
  });
});

describe("POST /api/webhooks/github", () => {
  let app: ApiApp;

  beforeEach(() => {
    app = createApp({
      logger: testLogger(),
      handle: harness.handle,
      webhookSecret: SECRET,
      auth: DUMMY_AUTH,
      ...UNUSED_INSTALLATION_DEPS,
      ...LISTED_OWNER_DEPS,
    });
  });

  it("200s signed opened events with PR, generation and debounced job rows", async () => {
    const before = Date.now();
    const res = await deliver(
      app,
      "pull_request",
      pullRequestPayload({ action: "opened" }),
    );
    expect(res.status).toBe(200);

    const prs = await harness.raw("select * from pull_request");
    expect(prs).toHaveLength(1);
    expect(prs[0]?.["state"]).toBe("open");
    expect(prs[0]?.["repo_slug"]).toBe("acme/widgets");

    const generations = await harness.raw("select * from generation");
    expect(generations).toHaveLength(1);
    expect(generations[0]?.["kind"]).toBe("brief");
    expect(generations[0]?.["status"]).toBe("pending");
    expect(generations[0]?.["head_sha"]).toBe(HEAD_SHA);
    expect(generations[0]?.["baseline_sha"]).toBeNull();

    const jobs = await harness.raw("select * from graphile_worker.jobs");
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.["task_identifier"]).toBe("generate");
    expect(jobs[0]?.["key"]).toBe(`generate:${String(prs[0]?.["id"])}`);
    expect(jobs[0]?.["payload"]).toEqual({
      installation_id: String(INSTALLATION_ID),
      pull_request_id: String(prs[0]?.["id"]),
      head_sha: HEAD_SHA,
    });
    const runAt = epochMs(jobs[0]?.["run_at"]);
    expect(runAt - before).toBeGreaterThan(55_000);
    expect(runAt - before).toBeLessThan(65_000);
  });

  it("traces a delivery as verify, dispatch and trigger under its route", async () => {
    const tracing = startTestTracing();
    const payload = pullRequestPayload({ action: "opened" });

    let spans: ReturnType<TestTracing["readFinishedSpans"]> = [];
    try {
      await tracing.runInSpan(async () => {
        await deliver(app, "pull_request", payload);
      });
      spans = tracing.readFinishedSpans();
    } finally {
      await tracing.stop();
    }
    const byName = new Map(spans.map((span) => [span.name, span]));
    expect(byName.get("webhook.verify")?.attributes).toMatchObject({
      "mergebrief.verified": true,
    });
    expect(byName.get("webhook.dispatch")?.attributes).toMatchObject({
      "mergebrief.webhook.kind": "pull-request",
      "mergebrief.webhook.action": "opened",
    });
    expect(byName.get("generation.trigger")?.attributes).toMatchObject({
      "mergebrief.applied": true,
      "mergebrief.queued": true,
    });
    expect(byName.has("POST /api/webhooks/github")).toBe(true);
  });

  it("a pull_request_review does NOT overwrite stored draft/author_login", async () => {
    // Ingest as a draft authored by author-octocat.
    expect(
      (
        await deliver(
          app,
          "pull_request",
          pullRequestPayload({
            action: "opened",
            draft: true,
            authorLogin: "author-octocat",
          }),
        )
      ).status,
    ).toBe(200);
    // A review carries neither draft nor author, must preserve both, exactly
    // as it preserves base_sha.
    expect(
      (await deliver(app, "pull_request_review", pullRequestReviewPayload()))
        .status,
    ).toBe(200);
    const prs = await harness.raw("select * from pull_request");
    expect(prs).toHaveLength(1);
    expect(prs[0]?.["draft"]).toBe(true);
    expect(prs[0]?.["author_login"]).toBe("author-octocat");
  });

  it("preserves stored author_login when the event author is deleted", async () => {
    // Ingest with a known author.
    expect(
      (
        await deliver(
          app,
          "pull_request",
          pullRequestPayload({
            action: "opened",
            draft: true,
            authorLogin: "author-octocat",
          }),
        )
      ).status,
    ).toBe(200);
    // Redeliver the same PR's synchronize with `pull_request.user: null`,
    // GitHub's deleted-author shape. The omitted parse field must preserve the
    // stored login (pinning webhook.ts's `=== undefined` spread against a
    // future `?? null` refactor), while draft still updates normally.
    expect(
      (
        await deliver(
          app,
          "pull_request",
          pullRequestPayload({
            action: "synchronize",
            draft: false,
            authorLogin: null,
          }),
        )
      ).status,
    ).toBe(200);
    const prs = await harness.raw("select * from pull_request");
    expect(prs).toHaveLength(1);
    expect(prs[0]?.["author_login"]).toBe("author-octocat");
    expect(prs[0]?.["draft"]).toBe(false);
  });

  it("clears the stored draft flag on a ready_for_review event", async () => {
    expect(
      (
        await deliver(
          app,
          "pull_request",
          pullRequestPayload({
            action: "opened",
            draft: true,
            authorLogin: "author-octocat",
          }),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await deliver(
          app,
          "pull_request",
          pullRequestPayload({
            action: "ready_for_review",
            draft: false,
            authorLogin: "author-octocat",
          }),
        )
      ).status,
    ).toBe(200);
    const prs = await harness.raw("select * from pull_request");
    expect(prs).toHaveLength(1);
    expect(prs[0]?.["draft"]).toBe(false);
    expect(prs[0]?.["author_login"]).toBe("author-octocat");
  });

  it("updates draft state without touching generation or enqueueing", async () => {
    // Ready-to-draft transitions update state only. Preserve the generation projection
    // and the earlier job without phantom pending status or an attempts increment.
    expect(
      (
        await deliver(
          app,
          "pull_request",
          pullRequestPayload({
            action: "opened",
            draft: false,
            authorLogin: "author-octocat",
          }),
        )
      ).status,
    ).toBe(200);
    const genBefore = await harness.raw(
      "select status, attempts from generation",
    );
    const jobsBefore = await harness.raw(
      "select id, run_at from graphile_worker.jobs",
    );
    expect(genBefore).toHaveLength(1);
    expect(jobsBefore).toHaveLength(1);

    expect(
      (
        await deliver(
          app,
          "pull_request",
          pullRequestPayload({
            action: "converted_to_draft",
            draft: true,
            authorLogin: "author-octocat",
          }),
        )
      ).status,
    ).toBe(200);
    const prs = await harness.raw("select * from pull_request");
    expect(prs).toHaveLength(1);
    expect(prs[0]?.["draft"]).toBe(true);
    expect(prs[0]?.["author_login"]).toBe("author-octocat");
    // Generation projection untouched (status AND attempts), job list identical
    // (same single job, run_at NOT pushed, no debounce replace happened).
    expect(
      await harness.raw("select status, attempts from generation"),
    ).toEqual(genBefore);
    expect(
      await harness.raw("select id, run_at from graphile_worker.jobs"),
    ).toEqual(jobsBefore);

    // A second conversion event converges (idempotent no-op when already draft).
    const secondConversion = makeDistinctEvent(
      pullRequestPayload({
        action: "converted_to_draft",
        draft: true,
        authorLogin: "author-octocat",
      }),
    );
    expect((await deliver(app, "pull_request", secondConversion)).status).toBe(
      200,
    );
    const again = await harness.raw("select draft from pull_request");
    expect(again).toHaveLength(1);
    expect(again[0]?.["draft"]).toBe(true);
  });

  it("a second event for one head keeps one attempt and the job's run_at", async () => {
    const payload = pullRequestPayload({ action: "opened" });
    expect((await deliver(app, "pull_request", payload)).status).toBe(200);
    await harness.raw("update graphile_worker.jobs set run_at = $1", [
      PINNED_RUN_AT.toISOString(),
    ]);

    const secondEvent = makeDistinctEvent(payload);
    expect((await deliver(app, "pull_request", secondEvent)).status).toBe(200);

    expect(await countRows(harness, "pull_request")).toBe(1);
    const generations = await harness.raw("select attempts from generation");
    expect(generations).toHaveLength(1);
    expect(generations[0]?.["attempts"]).toBe(1);

    const jobs = await harness.raw("select run_at from graphile_worker.jobs");
    expect(jobs).toHaveLength(1);
    expect(epochMs(jobs[0]?.["run_at"])).toBe(PINNED_RUN_AT.getTime());
  });

  it("200s submitted reviews on known PRs and queues generation", async () => {
    await seedPullRequest(harness, BigInt(REPO_ID), 2);
    const res = await deliver(
      app,
      "pull_request_review",
      pullRequestReviewPayload(),
    );
    expect(res.status).toBe(200);
    expect(await countRows(harness, "pull_request")).toBe(1);
    expect(await countRows(harness, "generation")).toBe(1);
    expect(await countRows(harness, "graphile_worker.jobs")).toBe(1);
  });

  it("200s reviews on unknown PRs without creating phantom rows", async () => {
    const res = await deliver(
      app,
      "pull_request_review",
      pullRequestReviewPayload(),
    );
    expect(res.status).toBe(200);
    expect(await countRows(harness, "pull_request")).toBe(0);
    expect(await countRows(harness, "generation")).toBe(0);
    expect(await countRows(harness, "graphile_worker.jobs")).toBe(0);
    // The unknown-PR skip extends to the checkpoint (FK needs the parent).
    expect(await countRows(harness, "checkpoint")).toBe(0);
  });

  it("pins submitted-review checkpoints to review.commit_id", async () => {
    await seedPullRequest(harness, BigInt(REPO_ID), 2);
    const viewedHead = "1111111111111111111111111111111111111111";
    // head.sha stays HEAD_SHA (a push landed mid-review), commit_id must win.
    const res = await deliver(
      app,
      "pull_request_review",
      pullRequestReviewPayload({ commitId: viewedHead }),
    );
    expect(res.status).toBe(200);
    const rows = await harness.raw(
      "select reviewer_id, reviewer_login, last_submitted_sha, installation_id from checkpoint",
    );
    expect(rows).toHaveLength(1);
    expect(String(rows[0]?.["last_submitted_sha"])).toBe(viewedHead);
    expect(Number(rows[0]?.["reviewer_id"])).toBe(21031067);
    expect(String(rows[0]?.["reviewer_login"])).toBe("reviewer");
    expect(Number(rows[0]?.["installation_id"])).toBe(INSTALLATION_ID);
    // The generation gap-filler still runs.
    expect(await countRows(harness, "graphile_worker.jobs")).toBe(1);
  });

  it("skips bot checkpoints while still queueing generation", async () => {
    await seedPullRequest(harness, BigInt(REPO_ID), 2);
    const res = await deliver(
      app,
      "pull_request_review",
      pullRequestReviewPayload({ userType: "Bot", userId: 49699333 }),
    );
    expect(res.status).toBe(200);
    expect(await countRows(harness, "checkpoint")).toBe(0);
    expect(await countRows(harness, "graphile_worker.jobs")).toBe(1);
  });

  describe("review checkpoints follow the reviewer's standing", () => {
    const REVIEW_REPO = { owner: "acme", repo: "widgets" };
    let fake: FakeGitHub;
    let capture: ReturnType<typeof testLogging>;
    let checking: ApiApp;

    beforeEach(async () => {
      fake = makeFakeGitHub();
      capture = testLogging({ LOG_LEVEL: "debug" });
      checking = createApp({
        logger: capture.logger,
        handle: harness.handle,
        webhookSecret: SECRET,
        auth: DUMMY_AUTH,
        ...buildFakeInstallationDeps(fake),
        ...LISTED_OWNER_DEPS,
      });
      await seedPullRequest(harness, BigInt(REPO_ID), 2);
    });

    function countPermissionReads(): number {
      return fake.listCalls("readCollaboratorPermission").length;
    }

    it.each(["OWNER", "MEMBER", "COLLABORATOR"])(
      "writes a %s reviewer's checkpoint without asking GitHub",
      async (authorAssociation) => {
        const res = await deliver(
          checking,
          "pull_request_review",
          pullRequestReviewPayload({ authorAssociation }),
        );
        expect(res.status).toBe(200);
        expect(await countRows(harness, "checkpoint")).toBe(1);
        expect(await countRows(harness, "graphile_worker.jobs")).toBe(1);
        expect(countPermissionReads()).toBe(0);
      },
    );

    it.each(["CONTRIBUTOR", "NONE"])(
      "checkpoints a private repo %s reviewer with no GitHub read",
      async (authorAssociation) => {
        const res = await deliver(
          checking,
          "pull_request_review",
          pullRequestReviewPayload({
            authorAssociation,
            visibility: "private",
          }),
        );
        expect(res.status).toBe(200);
        expect(await countRows(harness, "checkpoint")).toBe(1);
        expect(countPermissionReads()).toBe(0);
      },
    );

    it("skips a bot's checkpoint on a private repo", async () => {
      const res = await deliver(
        checking,
        "pull_request_review",
        pullRequestReviewPayload({
          userType: "Bot",
          userId: 49699333,
          authorAssociation: "NONE",
          visibility: "private",
        }),
      );
      expect(res.status).toBe(200);
      expect(await countRows(harness, "checkpoint")).toBe(0);
      expect(countPermissionReads()).toBe(0);
    });

    it("skips an internal repo CONTRIBUTOR GitHub grants only read", async () => {
      fake.addCollaboratorPermission(REVIEW_REPO, "reviewer", "read");
      const res = await deliver(
        checking,
        "pull_request_review",
        pullRequestReviewPayload({
          authorAssociation: "CONTRIBUTOR",
          visibility: "internal",
        }),
      );
      expect(res.status).toBe(200);
      expect(await countRows(harness, "checkpoint")).toBe(0);
      expect(countPermissionReads()).toBe(1);
    });

    it.each(["admin", "write"] as const)(
      "writes a CONTRIBUTOR reviewer's checkpoint when GitHub grants %s",
      async (permission) => {
        fake.addCollaboratorPermission(REVIEW_REPO, "reviewer", permission);
        const res = await deliver(
          checking,
          "pull_request_review",
          pullRequestReviewPayload({ authorAssociation: "CONTRIBUTOR" }),
        );
        expect(res.status).toBe(200);
        expect(await countRows(harness, "checkpoint")).toBe(1);
        expect(countPermissionReads()).toBe(1);
      },
    );

    it.each([
      "CONTRIBUTOR",
      "FIRST_TIME_CONTRIBUTOR",
      "FIRST_TIMER",
      "MANNEQUIN",
      "NONE",
      "SPONSOR",
    ])(
      "skips a read-only %s reviewer, still queueing",
      async (authorAssociation) => {
        fake.addCollaboratorPermission(REVIEW_REPO, "reviewer", "read");
        const res = await deliver(
          checking,
          "pull_request_review",
          pullRequestReviewPayload({ authorAssociation }),
        );
        expect(res.status).toBe(200);
        expect(await countRows(harness, "checkpoint")).toBe(0);
        expect(await countRows(harness, "graphile_worker.jobs")).toBe(1);
        expect(countPermissionReads()).toBe(1);
      },
    );

    it("skips a reviewer with no author_association GitHub grants read", async () => {
      fake.addCollaboratorPermission(REVIEW_REPO, "reviewer", "read");
      const payload = pullRequestReviewPayload();
      delete (payload["review"] as Record<string, unknown>)[
        "author_association"
      ];
      const res = await deliver(checking, "pull_request_review", payload);
      expect(res.status).toBe(200);
      expect(await countRows(harness, "checkpoint")).toBe(0);
      expect(await countRows(harness, "graphile_worker.jobs")).toBe(1);
    });

    it("logs an untrusted skip at debug with the login and association", async () => {
      fake.addCollaboratorPermission(REVIEW_REPO, "reviewer", "read");
      await deliver(
        checking,
        "pull_request_review",
        pullRequestReviewPayload({ authorAssociation: "NONE" }),
      );
      const skipped = capture
        .lines()
        .filter((line) => line["level"] === "debug")
        .find((line) => line["reviewerLogin"] === "reviewer");
      expect(skipped).toMatchObject({ association: "NONE" });
    });

    it("skips the checkpoint and warns when the permission read fails", async () => {
      fake.failOn("readCollaboratorPermission", FakeFailures.SERVER_ERROR);
      const res = await deliver(
        checking,
        "pull_request_review",
        pullRequestReviewPayload({ authorAssociation: "CONTRIBUTOR" }),
      );
      expect(res.status).toBe(200);
      expect(await countRows(harness, "checkpoint")).toBe(0);
      expect(await countRows(harness, "graphile_worker.jobs")).toBe(1);
      const warned = capture.lines().filter((line) => line["level"] === "warn");
      expect(warned).toEqual([
        expect.objectContaining({
          reviewerLogin: "reviewer",
          association: "CONTRIBUTOR",
          code: "request-failed",
        }),
      ]);
    });

    it("skips the checkpoint when the permission read passes its bound", async () => {
      const hanging = createApp({
        logger: capture.logger,
        handle: harness.handle,
        webhookSecret: SECRET,
        auth: DUMMY_AUTH,
        ...buildFakeInstallationDeps(fake),
        ...LISTED_OWNER_DEPS,
        bindInstallationGitHub: (installationId) => {
          const bound = fake.bindInstallationGitHub(installationId);
          return {
            ...bound,
            forRepo: (repo) => ({
              ...bound.forRepo(repo),
              readCollaboratorPermission: () => new Promise(() => undefined),
            }),
          };
        },
        webhookConfirmationTimeoutMs: 20,
      });
      const res = await deliver(
        hanging,
        "pull_request_review",
        pullRequestReviewPayload({ authorAssociation: "CONTRIBUTOR" }),
      );
      expect(res.status).toBe(200);
      expect(await countRows(harness, "checkpoint")).toBe(0);
      expect(await countRows(harness, "graphile_worker.jobs")).toBe(1);
      const warned = capture.lines().filter((line) => line["level"] === "warn");
      expect(warned).toEqual([expect.objectContaining({ timedOut: true })]);
    });

    it("writes no checkpoint for untrusted reviews on distinct commits", async () => {
      const untrustedReviewers = [301, 302, 303, 304, 305];
      for (const [index, userId] of untrustedReviewers.entries()) {
        const res = await deliver(
          checking,
          "pull_request_review",
          pullRequestReviewPayload({
            userId,
            authorAssociation: "NONE",
            commitId: String(index + 1).repeat(40),
          }),
        );
        expect(res.status).toBe(200);
      }
      expect(await countRows(harness, "checkpoint")).toBe(0);
    });
  });

  describe("the PR author's standing gates the trigger", () => {
    const AUTHOR_REPO = { owner: "acme", repo: "widgets" };
    const AUTHOR_LOGIN = "author-octocat";
    const NEXT_HEAD_SHA = "c".repeat(40);
    let fake: FakeGitHub;
    let capture: ReturnType<typeof testLogging>;
    let gating: ApiApp;

    beforeEach(() => {
      fake = makeFakeGitHub();
      capture = testLogging({ LOG_LEVEL: "debug" });
      gating = createApp({
        logger: capture.logger,
        handle: harness.handle,
        webhookSecret: SECRET,
        auth: DUMMY_AUTH,
        ...buildFakeInstallationDeps(fake),
        ...LISTED_OWNER_DEPS,
      });
    });

    /** The inputs of every collaborator-permission read, `{ owner, repo, login }`. */
    function listPermissionReads(): unknown[] {
      return fake
        .listCalls("readCollaboratorPermission")
        .map((call) => call.input);
    }

    async function readStatuses(): Promise<unknown[]> {
      const rows = await harness.raw(
        "select status from generation order by id",
      );
      return rows.map((row) => row["status"]);
    }

    const tenantCtx = parseTenantContext({ installationId: INSTALLATION_ID });
    const approverId = brandReviewerId(BigInt(REVIEWER_ID));

    async function readPullRequestRowId(): Promise<PullRequestRowId> {
      const prs = await harness.raw("select id from pull_request");
      const pullRequestId = BigInt(String(prs[0]?.["id"]));
      if (!isPullRequestRowId(pullRequestId)) {
        throw new Error("bad pr id");
      }
      return pullRequestId;
    }

    async function approvePullRequest(): Promise<void> {
      const pullRequestId = await readPullRequestRowId();
      await approveTestTrigger(
        harness.handle,
        tenantCtx,
        pullRequestId,
        approverId,
      );
    }

    async function deliverAdmittedOpen(): Promise<void> {
      fake.addCollaboratorPermission(AUTHOR_REPO, AUTHOR_LOGIN, "write");
      await deliver(
        gating,
        "pull_request",
        pullRequestPayload({
          action: "opened",
          authorAssociation: "CONTRIBUTOR",
        }),
      );
      expect(await readStatuses()).toEqual(["pending"]);
    }

    async function deliverReviewRequested(): Promise<Response> {
      return deliver(
        gating,
        "pull_request",
        pullRequestPayload({
          action: "review_requested",
          authorAssociation: "CONTRIBUTOR",
        }),
      );
    }

    it.each(["OWNER", "MEMBER", "COLLABORATOR"])(
      "projects a %s author's push pending without asking GitHub",
      async (authorAssociation) => {
        const res = await deliver(
          gating,
          "pull_request",
          pullRequestPayload({ action: "opened", authorAssociation }),
        );
        expect(res.status).toBe(200);
        expect(await readStatuses()).toEqual(["pending"]);
        expect(listPermissionReads()).toEqual([]);
      },
    );

    it.each(["CONTRIBUTOR", "FIRST_TIME_CONTRIBUTOR", "NONE"])(
      "holds a %s author's push GitHub grants only read",
      async (authorAssociation) => {
        fake.addCollaboratorPermission(AUTHOR_REPO, AUTHOR_LOGIN, "read");
        const res = await deliver(
          gating,
          "pull_request",
          pullRequestPayload({ action: "opened", authorAssociation }),
        );
        expect(res.status).toBe(200);
        expect(await readStatuses()).toEqual(["awaiting-trigger"]);
        expect(await countRows(harness, "graphile_worker.jobs")).toBe(1);
        expect(listPermissionReads()).toEqual([
          { ...AUTHOR_REPO, login: AUTHOR_LOGIN },
        ]);
      },
    );

    it("holds a push whose author has no author_association", async () => {
      fake.addCollaboratorPermission(AUTHOR_REPO, AUTHOR_LOGIN, "read");
      const res = await deliver(
        gating,
        "pull_request",
        pullRequestPayload({ action: "opened", authorAssociation: null }),
      );
      expect(res.status).toBe(200);
      expect(await readStatuses()).toEqual(["awaiting-trigger"]);
    });

    it("holds a push whose author account is gone without asking GitHub", async () => {
      const res = await deliver(
        gating,
        "pull_request",
        pullRequestPayload({
          action: "opened",
          authorLogin: null,
          authorAssociation: "NONE",
        }),
      );
      expect(res.status).toBe(200);
      expect(await readStatuses()).toEqual(["awaiting-trigger"]);
      expect(listPermissionReads()).toEqual([]);
    });

    it("never asks GitHub about a bot author and projects it pending", async () => {
      const res = await deliver(
        gating,
        "pull_request",
        pullRequestPayload({
          action: "opened",
          authorLogin: "renovate[bot]",
          authorType: "Bot",
          authorAssociation: "NONE",
        }),
      );
      expect(res.status).toBe(200);
      expect(await readStatuses()).toEqual(["pending"]);
      expect(listPermissionReads()).toEqual([]);
    });

    it("projects a private repo NONE author's push pending", async () => {
      const res = await deliver(
        gating,
        "pull_request",
        pullRequestPayload({
          action: "opened",
          authorAssociation: "NONE",
          visibility: "private",
        }),
      );
      expect(res.status).toBe(200);
      expect(await readStatuses()).toEqual(["pending"]);
      expect(listPermissionReads()).toEqual([]);
    });

    it("holds an internal repo NONE author's push GitHub grants read", async () => {
      fake.addCollaboratorPermission(AUTHOR_REPO, AUTHOR_LOGIN, "read");
      await deliver(
        gating,
        "pull_request",
        pullRequestPayload({
          action: "opened",
          authorAssociation: "NONE",
          visibility: "internal",
        }),
      );
      expect(await readStatuses()).toEqual(["awaiting-trigger"]);
    });

    it.each(["write", "admin"] as const)(
      "projects a public repo NONE author's push pending on %s access",
      async (permission) => {
        fake.addCollaboratorPermission(AUTHOR_REPO, AUTHOR_LOGIN, permission);
        await deliver(
          gating,
          "pull_request",
          pullRequestPayload({ action: "opened", authorAssociation: "NONE" }),
        );
        expect(await readStatuses()).toEqual(["pending"]);
        expect(listPermissionReads()).toHaveLength(1);
      },
    );

    it("holds the push and warns when the author's permission read fails", async () => {
      fake.failOn("readCollaboratorPermission", FakeFailures.SERVER_ERROR);
      const res = await deliver(
        gating,
        "pull_request",
        pullRequestPayload({ action: "opened", authorAssociation: "NONE" }),
      );
      expect(res.status).toBe(200);
      expect(await readStatuses()).toEqual(["awaiting-trigger"]);
      expect(await countRows(harness, "graphile_worker.jobs")).toBe(1);
      const warned = capture.lines().filter((line) => line["level"] === "warn");
      expect(warned).toEqual([
        expect.objectContaining({
          repoId: String(REPO_ID),
          prNumber: 2,
          code: "request-failed",
        }),
      ]);
      expect(warned[0]).not.toHaveProperty("authorLogin");
    });

    it("logs an off-team author at debug with the repo and PR only", async () => {
      fake.addCollaboratorPermission(AUTHOR_REPO, AUTHOR_LOGIN, "read");
      await deliver(
        gating,
        "pull_request",
        pullRequestPayload({ action: "opened", authorAssociation: "NONE" }),
      );
      const held = capture
        .lines()
        .filter((line) => line["level"] === "debug")
        .find((line) => String(line["msg"]).includes("author off the team"));
      expect(held).toMatchObject({ repoId: String(REPO_ID), prNumber: 2 });
      expect(held).not.toHaveProperty("evt");
      const logged = JSON.stringify(capture.lines());
      expect(logged).not.toContain(AUTHOR_LOGIN);
    });

    it("projects an approved PR's next push pending", async () => {
      await deliver(
        gating,
        "pull_request",
        pullRequestPayload({ action: "opened", authorAssociation: "NONE" }),
      );
      await approvePullRequest();
      await deliver(
        gating,
        "pull_request",
        pullRequestPayload({
          action: "synchronize",
          authorAssociation: "NONE",
          headSha: NEXT_HEAD_SHA,
        }),
      );
      expect(await readStatuses()).toEqual(["awaiting-trigger", "pending"]);
    });

    it("projects a promoted author's next push pending", async () => {
      await deliver(
        gating,
        "pull_request",
        pullRequestPayload({ action: "opened", authorAssociation: "NONE" }),
      );
      await deliver(
        gating,
        "pull_request",
        pullRequestPayload({
          action: "synchronize",
          authorAssociation: "COLLABORATOR",
          headSha: NEXT_HEAD_SHA,
        }),
      );
      expect(await readStatuses()).toEqual(["awaiting-trigger", "pending"]);
    });

    it("holds a submitted review on a gated PR", async () => {
      await seedPullRequest(harness, BigInt(REPO_ID), 2);
      fake.addCollaboratorPermission(AUTHOR_REPO, AUTHOR_LOGIN, "read");
      const res = await deliver(
        gating,
        "pull_request_review",
        pullRequestReviewPayload({ pullRequestAuthorAssociation: "NONE" }),
      );
      expect(res.status).toBe(200);
      expect(await readStatuses()).toEqual(["awaiting-trigger"]);
      expect(await countRows(harness, "checkpoint")).toBe(1);
    });

    it("skips the author's permission read on a review of an approved PR", async () => {
      await seedPullRequest(harness, BigInt(REPO_ID), 2);
      await approvePullRequest();
      fake.addCollaboratorPermission(AUTHOR_REPO, AUTHOR_LOGIN, "read");
      const res = await deliver(
        gating,
        "pull_request_review",
        pullRequestReviewPayload({ pullRequestAuthorAssociation: "NONE" }),
      );
      expect(res.status).toBe(200);
      expect(await readStatuses()).toEqual(["pending"]);
      expect(listPermissionReads()).toEqual([]);
    });

    it("asks GitHub about the PR author on a review, not the reviewer", async () => {
      await seedPullRequest(harness, BigInt(REPO_ID), 2);
      fake.addCollaboratorPermission(AUTHOR_REPO, AUTHOR_LOGIN, "write");
      await deliver(
        gating,
        "pull_request_review",
        pullRequestReviewPayload({ pullRequestAuthorAssociation: "NONE" }),
      );
      expect(await readStatuses()).toEqual(["pending"]);
      expect(listPermissionReads()).toEqual([
        { ...AUTHOR_REPO, login: AUTHOR_LOGIN },
      ]);
    });

    it("runs the reviewer and author reads at once on a review", async () => {
      await seedPullRequest(harness, BigInt(REPO_ID), 2);
      fake.addCollaboratorPermission(AUTHOR_REPO, "reviewer", "write");
      fake.addCollaboratorPermission(AUTHOR_REPO, AUTHOR_LOGIN, "write");
      const started: string[] = [];
      let releaseReads: () => void = () => undefined;
      const bothStarted = new Promise<void>((resolve) => {
        releaseReads = resolve;
      });
      const concurrent = createApp({
        logger: capture.logger,
        handle: harness.handle,
        webhookSecret: SECRET,
        auth: DUMMY_AUTH,
        ...buildFakeInstallationDeps(fake),
        ...LISTED_OWNER_DEPS,
        bindInstallationGitHub: (installationId) => {
          const bound = fake.bindInstallationGitHub(installationId);
          return {
            ...bound,
            forRepo: (repo) => {
              const repoReads = bound.forRepo(repo);
              return {
                ...repoReads,
                readCollaboratorPermission: async (login) => {
                  started.push(login);
                  if (started.length === 2) {
                    releaseReads();
                  }
                  await bothStarted;
                  return repoReads.readCollaboratorPermission(login);
                },
              };
            },
          };
        },
        webhookConfirmationTimeoutMs: 500,
      });

      const res = await deliver(
        concurrent,
        "pull_request_review",
        pullRequestReviewPayload({
          authorAssociation: "NONE",
          pullRequestAuthorAssociation: "NONE",
        }),
      );

      expect(res.status).toBe(200);
      expect(started.toSorted()).toEqual([AUTHOR_LOGIN, "reviewer"]);
      expect(await countRows(harness, "checkpoint")).toBe(1);
      expect(await readStatuses()).toEqual(["pending"]);
      const timedOut = capture
        .lines()
        .filter((line) => line["timedOut"] === true);
      expect(timedOut).toEqual([]);
    });

    it("keeps an admitted head pending when a later author read fails", async () => {
      await deliverAdmittedOpen();
      fake.failOn("readCollaboratorPermission", FakeFailures.SERVER_ERROR);

      const res = await deliverReviewRequested();

      expect(res.status).toBe(200);
      expect(await readStatuses()).toEqual(["pending"]);
      expect(await countRows(harness, "graphile_worker.jobs")).toBe(1);
    });

    it("keeps a failed head's code and Regenerate when a later read fails", async () => {
      await deliverAdmittedOpen();
      await harness.raw(
        "update generation set status = 'failed', error_code = 'provider-timeout'",
      );
      await harness.raw("delete from graphile_worker.jobs");
      fake.failOn("readCollaboratorPermission", FakeFailures.SERVER_ERROR);

      const res = await deliverReviewRequested();

      expect(res.status).toBe(200);
      expect(
        await harness.raw("select status, error_code from generation"),
      ).toEqual([{ status: "failed", error_code: "provider-timeout" }]);
      expect(await countRows(harness, "graphile_worker.jobs")).toBe(0);
      const regenerated = await createIngestRoutines(
        harness.handle,
        tenantCtx,
      ).triggerOnDemand({ pullRequestId: await readPullRequestRowId() });
      expect(regenerated).toBe(TriggerOnDemandOutcomes.QUEUED);
    });

    it("keeps a held head held when a later author read fails", async () => {
      fake.addCollaboratorPermission(AUTHOR_REPO, AUTHOR_LOGIN, "read");
      await deliver(
        gating,
        "pull_request",
        pullRequestPayload({
          action: "opened",
          authorAssociation: "CONTRIBUTOR",
        }),
      );
      fake.failOn("readCollaboratorPermission", FakeFailures.SERVER_ERROR);

      const res = await deliverReviewRequested();

      expect(res.status).toBe(200);
      expect(await readStatuses()).toEqual(["awaiting-trigger"]);
      expect(await countRows(harness, "graphile_worker.jobs")).toBe(1);
    });

    it("keeps an admitted head pending when a review's author read fails", async () => {
      await deliverAdmittedOpen();
      fake.failOn("readCollaboratorPermission", FakeFailures.SERVER_ERROR);

      const res = await deliver(
        gating,
        "pull_request_review",
        pullRequestReviewPayload({
          pullRequestAuthorAssociation: "CONTRIBUTOR",
        }),
      );

      expect(res.status).toBe(200);
      expect(await readStatuses()).toEqual(["pending"]);
    });

    it("keeps drafts-off ahead of the gate on a push", async () => {
      const draftsOff = createApp({
        logger: testLogger(),
        handle: harness.handle,
        webhookSecret: SECRET,
        auth: DUMMY_AUTH,
        ...buildFakeInstallationDeps(fake),
        ...LISTED_OWNER_DEPS,
        draftPolicy: { generate: false, debounceSeconds: null },
      });
      const res = await deliver(
        draftsOff,
        "pull_request",
        pullRequestPayload({
          action: "opened",
          draft: true,
          authorAssociation: "NONE",
        }),
      );
      expect(res.status).toBe(200);
      expect(await countRows(harness, "generation")).toBe(0);
      expect(await countRows(harness, "graphile_worker.jobs")).toBe(0);
      expect(listPermissionReads()).toEqual([]);
    });

    it("keeps drafts-off ahead of the gate on a review", async () => {
      const draftsOff = createApp({
        logger: testLogger(),
        handle: harness.handle,
        webhookSecret: SECRET,
        auth: DUMMY_AUTH,
        ...buildFakeInstallationDeps(fake),
        ...LISTED_OWNER_DEPS,
        draftPolicy: { generate: false, debounceSeconds: null },
      });
      await deliver(
        draftsOff,
        "pull_request",
        pullRequestPayload({ action: "opened", draft: true }),
      );
      await deliver(
        draftsOff,
        "pull_request_review",
        pullRequestReviewPayload({ pullRequestAuthorAssociation: "NONE" }),
      );
      expect(await countRows(harness, "generation")).toBe(0);
      expect(listPermissionReads()).toEqual([]);
    });
  });

  it("keeps the newest submitted review on out-of-order delivery", async () => {
    await seedPullRequest(harness, BigInt(REPO_ID), 2);
    const newerSha = "2222222222222222222222222222222222222222";
    const olderSha = "3333333333333333333333333333333333333333";
    await deliver(
      app,
      "pull_request_review",
      pullRequestReviewPayload({
        commitId: newerSha,
        submittedAt: "2026-07-07T12:05:00Z",
      }),
    );
    // The older submission arrives late (redelivery / out-of-order).
    const res = await deliver(
      app,
      "pull_request_review",
      pullRequestReviewPayload({
        commitId: olderSha,
        submittedAt: "2026-07-07T12:00:00Z",
      }),
    );
    expect(res.status).toBe(200);
    const rows = await harness.raw("select last_submitted_sha from checkpoint");
    expect(rows).toHaveLength(1);
    expect(String(rows[0]?.["last_submitted_sha"])).toBe(newerSha);
  });

  it("invalid signature → 401 and NOTHING written", async () => {
    const res = await deliver(
      app,
      "pull_request",
      pullRequestPayload({ action: "opened" }),
      {
        secret: "wrong-secret",
      },
    );
    expect(res.status).toBe(401);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(((await res.json()) as { code?: string }).code).toBe(
      "invalid-signature",
    );
    expect(await countRows(harness, "pull_request")).toBe(0);
    expect(await countRows(harness, "graphile_worker.jobs")).toBe(0);
  });

  it("oversized body → 413 before signature verification work", async () => {
    const res = await app.request("/api/webhooks/github", {
      method: "POST",
      headers: {
        "x-github-event": "pull_request",
        "x-hub-signature-256": "sha256=bogus",
        "content-type": "application/json",
      },
      body: "x".repeat(1_048_577),
    });
    expect(res.status).toBe(413);
    expect(await countRows(harness, "pull_request")).toBe(0);
    expect(await countRows(harness, "graphile_worker.jobs")).toBe(0);
  });

  it("missing signature → 401 and NOTHING written", async () => {
    const body = JSON.stringify(pullRequestPayload({ action: "opened" }));
    const res = await app.request("/api/webhooks/github", {
      method: "POST",
      headers: {
        "x-github-event": "pull_request",
        "content-type": "application/json",
      },
      body,
    });
    expect(res.status).toBe(401);
    expect(await countRows(harness, "pull_request")).toBe(0);
  });

  it("signed but malformed handled payload → 400, nothing written", async () => {
    const res = await deliver(app, "pull_request", {
      action: "opened",
      number: 2,
    });
    expect(res.status).toBe(400);
    expect(await countRows(harness, "pull_request")).toBe(0);
  });

  it("pull_request closed → 200, terminal state, NO new job", async () => {
    await seedPullRequest(harness, BigInt(REPO_ID), 2);
    const res = await deliver(
      app,
      "pull_request",
      pullRequestPayload({ action: "closed", merged: false }),
    );
    expect(res.status).toBe(200);

    const prs = await harness.raw("select state, closed_at from pull_request");
    expect(prs).toHaveLength(1);
    expect(prs[0]?.["state"]).toBe("closed");
    expect(prs[0]?.["closed_at"]).not.toBeNull();
    expect(await countRows(harness, "graphile_worker.jobs")).toBe(0);
  });

  it("a close over a tracked Entry comment queues the head's Entry sync", async () => {
    await deliver(
      app,
      "pull_request",
      pullRequestPayload({ action: "opened" }),
    );
    await harness.raw("delete from graphile_worker.jobs");
    await harness.raw("update pull_request set entry_comment_id = 41");

    const res = await deliver(
      app,
      "pull_request",
      pullRequestPayload({ action: "closed", merged: true }),
    );

    expect(res.status).toBe(200);
    const jobs = await harness.raw(
      "select task_identifier, key, max_attempts from graphile_worker.jobs",
    );
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.["task_identifier"]).toBe("sync-entry");
    expect(String(jobs[0]?.["key"])).toMatch(/^sync-entry:\d+:[0-9a-f]{40}$/);
    expect(jobs[0]?.["max_attempts"]).toBe(ENTRY_SYNC_MAX_ATTEMPTS);
  });

  it("a stale synchronize redelivered after close does NOT reopen the PR", async () => {
    // opened → closed → a late/redelivered synchronize (a generation trigger
    // that writes state:open). The terminal lifecycle must survive.
    expect(
      (
        await deliver(
          app,
          "pull_request",
          pullRequestPayload({ action: "opened" }),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await deliver(
          app,
          "pull_request",
          pullRequestPayload({ action: "closed" }),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await deliver(
          app,
          "pull_request",
          pullRequestPayload({ action: "synchronize" }),
        )
      ).status,
    ).toBe(200);

    const prs = await harness.raw("select state, closed_at from pull_request");
    expect(prs).toHaveLength(1);
    expect(prs[0]?.["state"]).toBe("closed");
    expect(prs[0]?.["closed_at"]).not.toBeNull();
  });

  it("an explicit reopened event transitions a closed PR back to open", async () => {
    expect(
      (
        await deliver(
          app,
          "pull_request",
          pullRequestPayload({ action: "opened" }),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await deliver(
          app,
          "pull_request",
          pullRequestPayload({ action: "closed" }),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await deliver(
          app,
          "pull_request",
          pullRequestPayload({ action: "reopened" }),
        )
      ).status,
    ).toBe(200);

    const prs = await harness.raw("select state, closed_at from pull_request");
    expect(prs[0]?.["state"]).toBe("open");
    expect(prs[0]?.["closed_at"]).toBeNull();
  });

  describe("the late event guard", () => {
    const T1 = "2026-09-20T10:00:00Z";
    const T2 = "2026-09-20T10:05:00Z";

    async function send(payload: Record<string, unknown>): Promise<void> {
      expect((await deliver(app, "pull_request", payload)).status).toBe(200);
    }

    async function readRow(): Promise<Record<string, unknown>> {
      const rows = await harness.raw(
        "select state, closed_at, github_updated_at from pull_request",
      );
      expect(rows).toHaveLength(1);
      const row = rows[0];
      if (row === undefined) {
        throw new Error("unreachable");
      }
      return row;
    }

    it("a late close after a reopen leaves the row open", async () => {
      await send(pullRequestPayload({ action: "opened", updatedAt: T1 }));
      await send(pullRequestPayload({ action: "reopened", updatedAt: T2 }));
      await send(
        pullRequestPayload({
          action: "closed",
          merged: false,
          updatedAt: T1,
          closedAt: T1,
        }),
      );

      const row = await readRow();
      expect(row["state"]).toBe("open");
      expect(row["closed_at"]).toBeNull();
    });

    it("a late reopen after a close leaves the row closed", async () => {
      await send(pullRequestPayload({ action: "opened", updatedAt: T1 }));
      await send(
        pullRequestPayload({
          action: "closed",
          merged: false,
          updatedAt: T2,
          closedAt: T2,
        }),
      );
      await send(pullRequestPayload({ action: "reopened", updatedAt: T1 }));

      const row = await readRow();
      expect(row["state"]).toBe("closed");
      expect(row["closed_at"]).not.toBeNull();
    });

    it("a late push does not replace the waiting job", async () => {
      await send(pullRequestPayload({ action: "opened", updatedAt: T1 }));
      await send(
        pullRequestPayload({
          action: "synchronize",
          headSha: "b".repeat(40),
          updatedAt: T2,
        }),
      );
      await send(
        pullRequestPayload({
          action: "synchronize",
          headSha: "c".repeat(40),
          updatedAt: T1,
        }),
      );

      const jobs = await harness.raw(
        "select payload->>'head_sha' as head from graphile_worker.jobs",
      );
      expect(jobs).toEqual([{ head: "b".repeat(40) }]);
      const generations = await harness.raw(
        "select head_sha from generation order by id",
      );
      expect(generations.map((row) => row["head_sha"])).toEqual([
        HEAD_SHA,
        "b".repeat(40),
      ]);
    });

    it("equal timestamps apply", async () => {
      await send(pullRequestPayload({ action: "opened", updatedAt: T1 }));
      await send(
        pullRequestPayload({
          action: "closed",
          merged: false,
          updatedAt: T1,
          closedAt: T1,
        }),
      );

      expect((await readRow())["state"]).toBe("closed");
    });

    it("an empty stored timestamp applies", async () => {
      await send(pullRequestPayload({ action: "opened" }));
      await send(
        pullRequestPayload({
          action: "closed",
          merged: false,
          updatedAt: T1,
          closedAt: T1,
        }),
      );

      const row = await readRow();
      expect(row["state"]).toBe("closed");
      expect(epochMs(row["github_updated_at"])).toBe(Date.parse(T1));
    });

    it("a merge landing on a closed row repairs it", async () => {
      await send(pullRequestPayload({ action: "opened", updatedAt: T1 }));
      await send(
        pullRequestPayload({
          action: "closed",
          merged: false,
          updatedAt: T1,
          closedAt: T1,
        }),
      );
      await send(
        pullRequestPayload({
          action: "closed",
          merged: true,
          updatedAt: T2,
          closedAt: T2,
        }),
      );

      const row = await readRow();
      expect(row["state"]).toBe("merged");
      expect(epochMs(row["closed_at"])).toBe(Date.parse(T2));
    });

    it("an older push after a draft conversion does not clear the draft", async () => {
      await send(pullRequestPayload({ action: "opened", updatedAt: T1 }));
      await send(
        pullRequestPayload({
          action: "converted_to_draft",
          draft: true,
          headSha: "c".repeat(40),
          updatedAt: T2,
        }),
      );
      await send(
        pullRequestPayload({
          action: "synchronize",
          headSha: "c".repeat(40),
          updatedAt: T1,
        }),
      );

      const rows = await harness.raw("select draft from pull_request");
      expect(rows).toEqual([{ draft: true }]);
      const jobs = await harness.raw(
        "select payload->>'head_sha' as head from graphile_worker.jobs",
      );
      expect(jobs).toEqual([{ head: HEAD_SHA }]);
    });

    it("a late draft conversion does not undo a ready flip", async () => {
      await send(pullRequestPayload({ action: "opened", updatedAt: T1 }));
      await send(
        pullRequestPayload({ action: "ready_for_review", updatedAt: T2 }),
      );
      await send(
        pullRequestPayload({
          action: "converted_to_draft",
          draft: true,
          updatedAt: T1,
        }),
      );

      const rows = await harness.raw("select draft from pull_request");
      expect(rows).toEqual([{ draft: false }]);
    });

    it("a late review still writes its checkpoint", async () => {
      await send(pullRequestPayload({ action: "opened", updatedAt: T2 }));
      const res = await deliver(
        app,
        "pull_request_review",
        pullRequestReviewPayload({ submittedAt: T1 }),
      );

      expect(res.status).toBe(200);
      expect(await countRows(harness, "checkpoint")).toBe(1);
    });
  });

  it("installation created → 200, no writes", async () => {
    const res = await deliver(
      app,
      "installation",
      installationPayload("created"),
    );
    expect(res.status).toBe(200);
    expect(await countRows(harness, "pull_request")).toBe(0);
    expect(await countRows(harness, "audit_log")).toBe(0);
  });

  describe("destructive events confirm with GitHub before purging", () => {
    const INSTALLATION = brandInstallationId(BigInt(INSTALLATION_ID));
    const REPO = brandRepoId(BigInt(REPO_ID));
    const OTHER_REPO = brandRepoId(BigInt(OTHER_REPO_ID));
    let fake: FakeGitHub;
    let capture: ReturnType<typeof testLogging>;
    let confirming: ApiApp;

    beforeEach(() => {
      fake = makeFakeGitHub();
      capture = testLogging();
      confirming = createApp({
        logger: capture.logger,
        handle: harness.handle,
        webhookSecret: SECRET,
        auth: DUMMY_AUTH,
        ...buildFakeInstallationDeps(fake),
        ...LISTED_OWNER_DEPS,
      });
    });

    function findWarnLines(): ReturnType<typeof capture.lines> {
      return capture.lines().filter((line) => line["level"] === "warn");
    }

    async function readDeleteAudits(): Promise<Record<string, unknown>[]> {
      return harness.raw(
        "select target_type, installation_id from audit_log where operation = 'delete'",
      );
    }

    async function readRemainingRepoIds(): Promise<string[]> {
      const rows = await harness.raw(
        "select repo_id from pull_request order by repo_id",
      );
      return rows.map((row) => String(row["repo_id"]));
    }

    function makeRemovalPayload(repoIds: number[]): Record<string, unknown> {
      return installationRepositoriesPayload({
        action: "removed",
        removedRepoIds: repoIds,
      });
    }

    it("installation deleted and gone at GitHub purges the tenant", async () => {
      await seedPullRequest(harness, BigInt(REPO_ID), 2);
      fake.removeInstallation(INSTALLATION);

      const res = await deliver(
        confirming,
        "installation",
        installationPayload("deleted"),
      );
      expect(res.status).toBe(200);

      expect(await countRows(harness, "pull_request")).toBe(0);
      const audits = await readDeleteAudits();
      expect(audits).toHaveLength(1);
      expect(audits[0]?.["target_type"]).toBe("installation");
      expect(String(audits[0]?.["installation_id"])).toBe(
        String(INSTALLATION_ID),
      );
    });

    it("installation deleted while GitHub lists it keeps the tenant and warns", async () => {
      await seedPullRequest(harness, BigInt(REPO_ID), 2);

      const res = await deliver(
        confirming,
        "installation",
        installationPayload("deleted"),
      );
      expect(res.status).toBe(200);

      expect(await countRows(harness, "pull_request")).toBe(1);
      expect(await readDeleteAudits()).toHaveLength(0);
      const warnings = findWarnLines();
      expect(warnings).toHaveLength(1);
      expect(warnings[0]?.["evt"]).toBeUndefined();
      expect(warnings[0]?.["installationId"]).toBe(String(INSTALLATION_ID));
    });

    it("installation deleted with GitHub unreachable answers 502 unrecorded", async () => {
      await seedPullRequest(harness, BigInt(REPO_ID), 2);
      fake.failOn("readInstallationPresence", FakeFailures.SERVER_ERROR);

      const res = await deliver(
        confirming,
        "installation",
        installationPayload("deleted"),
      );
      expect(res.status).toBe(502);
      expect(await res.json()).toMatchObject({ code: "github-unavailable" });

      expect(await countRows(harness, "pull_request")).toBe(1);
      expect(await readDeleteAudits()).toHaveLength(0);
      expect(await countRows(harness, "webhook_delivery")).toBe(0);
    });

    it("a redelivery after a 502 purges once GitHub answers gone", async () => {
      await seedPullRequest(harness, BigInt(REPO_ID), 2);
      fake.failOn("readInstallationPresence", FakeFailures.SERVER_ERROR);
      const payload = installationPayload("deleted");
      expect((await deliver(confirming, "installation", payload)).status).toBe(
        502,
      );

      const recovered = makeFakeGitHub();
      recovered.removeInstallation(INSTALLATION);
      const later = createApp({
        logger: testLogger(),
        handle: harness.handle,
        webhookSecret: SECRET,
        auth: DUMMY_AUTH,
        ...buildFakeInstallationDeps(recovered),
        ...LISTED_OWNER_DEPS,
      });
      const res = await deliver(later, "installation", payload);

      expect(res.status).toBe(200);
      expect(await countRows(harness, "pull_request")).toBe(0);
    });

    it("a replayed deletion after a reinstall is a no-op without error", async () => {
      await seedPullRequest(harness, BigInt(REPO_ID), 2);
      fake.removeInstallation(INSTALLATION);
      const payload = installationPayload("deleted");
      expect((await deliver(confirming, "installation", payload)).status).toBe(
        200,
      );

      const res = await deliver(
        confirming,
        "installation",
        makeDistinctEvent(payload),
      );

      expect(res.status).toBe(200);
      expect(await countRows(harness, "pull_request")).toBe(0);
    });

    it("a confirmation past its bound answers 502 and purges nothing", async () => {
      await seedPullRequest(harness, BigInt(REPO_ID), 2);
      const hanging = createApp({
        logger: testLogger(),
        handle: harness.handle,
        webhookSecret: SECRET,
        auth: DUMMY_AUTH,
        ...buildFakeInstallationDeps(fake),
        ...LISTED_OWNER_DEPS,
        readInstallationPresence: () => new Promise(() => undefined),
        webhookConfirmationTimeoutMs: 20,
      });

      const res = await deliver(
        hanging,
        "installation",
        installationPayload("deleted"),
      );

      expect(res.status).toBe(502);
      expect(await countRows(harness, "pull_request")).toBe(1);
      expect(await countRows(harness, "webhook_delivery")).toBe(0);
    });

    it("repos removed purges only the repos GitHub no longer lists", async () => {
      await seedPullRequest(harness, BigInt(REPO_ID), 2);
      await seedPullRequest(harness, BigInt(OTHER_REPO_ID), 5);
      fake.setInstallationRepoIds(INSTALLATION, [OTHER_REPO]);

      const res = await deliver(
        confirming,
        "installation_repositories",
        makeRemovalPayload([REPO_ID, OTHER_REPO_ID]),
      );
      expect(res.status).toBe(200);

      expect(await readRemainingRepoIds()).toEqual([String(OTHER_REPO_ID)]);
      const audits = await readDeleteAudits();
      expect(audits).toHaveLength(1);
      expect(audits[0]?.["target_type"]).toBe("repo");
      const warnings = findWarnLines();
      expect(warnings).toHaveLength(1);
      expect(warnings[0]?.["evt"]).toBeUndefined();
      expect(warnings[0]?.["repoIds"]).toEqual([String(OTHER_REPO_ID)]);
    });

    it("repos removed keeps a repo GitHub still lists", async () => {
      await seedPullRequest(harness, BigInt(REPO_ID), 2);
      fake.setInstallationRepoIds(INSTALLATION, [REPO]);

      const res = await deliver(
        confirming,
        "installation_repositories",
        makeRemovalPayload([REPO_ID]),
      );
      expect(res.status).toBe(200);

      expect(await countRows(harness, "pull_request")).toBe(1);
      expect(await readDeleteAudits()).toHaveLength(0);
      expect(findWarnLines()).toHaveLength(1);
    });

    it("repos removed from a gone installation purges every removed repo", async () => {
      await seedPullRequest(harness, BigInt(REPO_ID), 2);
      await seedPullRequest(harness, BigInt(OTHER_REPO_ID), 5);
      fake.removeInstallation(INSTALLATION);

      const res = await deliver(
        confirming,
        "installation_repositories",
        makeRemovalPayload([REPO_ID, OTHER_REPO_ID]),
      );
      expect(res.status).toBe(200);

      expect(await countRows(harness, "pull_request")).toBe(0);
      expect(findWarnLines()).toHaveLength(0);
    });

    it("repos removed from an unlistable present installation answers 502", async () => {
      await seedPullRequest(harness, BigInt(REPO_ID), 2);
      fake.failOn("listInstallationRepoIds", FakeFailures.FORBIDDEN);

      const res = await deliver(
        confirming,
        "installation_repositories",
        makeRemovalPayload([REPO_ID]),
      );
      expect(res.status).toBe(502);
      expect(await res.json()).toMatchObject({ code: "github-unavailable" });

      expect(await countRows(harness, "pull_request")).toBe(1);
      expect(await countRows(harness, "webhook_delivery")).toBe(0);
    });
  });

  it("200s ignored pull_request labeled events without writes", async () => {
    const res = await deliver(
      app,
      "pull_request",
      pullRequestPayload({ action: "labeled" }),
    );
    expect(res.status).toBe(200);
    expect(await countRows(harness, "pull_request")).toBe(0);
    expect(await countRows(harness, "graphile_worker.jobs")).toBe(0);
  });

  describe("events a stored brief covers", () => {
    const MOVED_BASE_SHA = "a".repeat(40);
    const BASE_MOVED = {
      base: { ref: { from: "main" }, sha: { from: BASE_SHA } },
    };

    /** Open the PR, store a brief for its pair and drain the job. */
    async function openWithStoredBrief(): Promise<void> {
      await deliver(
        app,
        "pull_request",
        pullRequestPayload({ action: "opened" }),
      );
      const prs = await harness.raw("select id from pull_request");
      const pullRequestId = BigInt(String(prs[0]?.["id"]));
      if (!isPullRequestRowId(pullRequestId)) {
        throw new Error("bad pr id");
      }
      const ctx = parseTenantContext({ installationId: INSTALLATION_ID });
      await createArtifactStore(harness.handle, ctx).briefs.write({
        pullRequestId,
        baseSha: BASE_SHA,
        headSha: HEAD_SHA,
        headIndex: 1,
        commitCount: 1,
        provider: "stub",
        model: "stub",
        effort: "low",
        bodyVersion: STORED_BODY_VERSION,
        body: "{}",
        usedGroupIds: [],
      });
      await harness.raw("update generation set status = 'succeeded'");
      await harness.raw("delete from graphile_worker.jobs");
    }

    /** A job for the uncovered work, or none; the projection stays as drained. */
    async function expectQueued(queued: boolean): Promise<void> {
      const jobs = await harness.raw("select id from graphile_worker.jobs");
      const generations = await harness.raw(
        "select status, attempts from generation",
      );
      expect(jobs).toHaveLength(queued ? 1 : 0);
      expect(generations).toEqual([{ status: "succeeded", attempts: 0 }]);
    }

    it("a synchronize for the briefed head queues nothing", async () => {
      await openWithStoredBrief();
      await deliver(
        app,
        "pull_request",
        pullRequestPayload({ action: "synchronize" }),
      );
      await expectQueued(false);
    });

    it("a reopen of the briefed pair queues nothing", async () => {
      await openWithStoredBrief();
      await deliver(
        app,
        "pull_request",
        pullRequestPayload({ action: "reopened" }),
      );
      await expectQueued(false);
    });

    it("a ready flip queues, entry comment or not", async () => {
      await openWithStoredBrief();
      await harness.raw("update pull_request set entry_comment_id = 4242");
      await deliver(
        app,
        "pull_request",
        pullRequestPayload({ action: "ready_for_review" }),
      );
      await expectQueued(true);
    });

    it("a submitted review queues", async () => {
      await openWithStoredBrief();
      await deliver(app, "pull_request_review", pullRequestReviewPayload());
      await expectQueued(true);
    });

    it("an edit that moved the base queues", async () => {
      await openWithStoredBrief();
      await deliver(
        app,
        "pull_request",
        pullRequestPayload({
          action: "edited",
          baseSha: MOVED_BASE_SHA,
          changes: BASE_MOVED,
        }),
      );
      const jobs = await harness.raw("select id from graphile_worker.jobs");
      expect(jobs).toHaveLength(1);
      const prs = await harness.raw("select base_sha from pull_request");
      expect(prs[0]?.["base_sha"]).toBe(MOVED_BASE_SHA);
    });

    it("an edit that left the base alone queues nothing", async () => {
      await openWithStoredBrief();
      await deliver(
        app,
        "pull_request",
        pullRequestPayload({
          action: "edited",
          changes: { title: { from: "Old title" } },
        }),
      );
      await expectQueued(false);
    });
  });

  describe("draft generation policy", () => {
    function appWithPolicy(policy: {
      generate: boolean;
      debounceSeconds: number | null;
    }): ApiApp {
      return createApp({
        logger: testLogger(),
        handle: harness.handle,
        webhookSecret: SECRET,
        auth: DUMMY_AUTH,
        ...UNUSED_INSTALLATION_DEPS,
        ...LISTED_OWNER_DEPS,
        draftPolicy: policy,
      });
    }

    async function jobRunAtDelta(before: number): Promise<number> {
      const jobs = await harness.raw("select run_at from graphile_worker.jobs");
      expect(jobs).toHaveLength(1);
      return epochMs(jobs[0]?.["run_at"]) - before;
    }

    it("damps draft regeneration only after success and when configured", async () => {
      const damped = appWithPolicy({ generate: true, debounceSeconds: 900 });
      await deliver(
        damped,
        "pull_request",
        pullRequestPayload({ action: "opened", draft: true }),
      );
      await harness.raw("update generation set status = 'succeeded'");
      await harness.raw("delete from graphile_worker.jobs");
      const before = Date.now();
      await deliver(
        damped,
        "pull_request",
        pullRequestPayload({ action: "synchronize", draft: true }),
      );
      const delta = await jobRunAtDelta(before);
      expect(delta).toBeGreaterThan(890_000);
      expect(delta).toBeLessThan(910_000);
    });

    it("keeps a draft's first brief on the normal window despite damping", async () => {
      const damped = appWithPolicy({ generate: true, debounceSeconds: 900 });
      const before = Date.now();
      await deliver(
        damped,
        "pull_request",
        pullRequestPayload({ action: "opened", draft: true }),
      );
      const delta = await jobRunAtDelta(before);
      expect(delta).toBeGreaterThan(55_000);
      expect(delta).toBeLessThan(65_000);
    });

    it("non-draft regenerations never damp", async () => {
      const damped = appWithPolicy({ generate: true, debounceSeconds: 900 });
      await deliver(
        damped,
        "pull_request",
        pullRequestPayload({ action: "opened", draft: false }),
      );
      await harness.raw("update generation set status = 'succeeded'");
      const before = Date.now();
      await deliver(
        damped,
        "pull_request",
        pullRequestPayload({ action: "synchronize", draft: false }),
      );
      const delta = await jobRunAtDelta(before);
      expect(delta).toBeLessThan(65_000);
    });

    it("generate off: records draft state without generating or enqueueing", async () => {
      const off = appWithPolicy({ generate: false, debounceSeconds: null });
      const res = await deliver(
        off,
        "pull_request",
        pullRequestPayload({ action: "opened", draft: true }),
      );
      expect(res.status).toBe(200);
      const prs = await harness.raw("select * from pull_request");
      expect(prs).toHaveLength(1);
      expect(prs[0]?.["draft"]).toBe(true);
      expect(await countRows(harness, "generation")).toBe(0);
      expect(await countRows(harness, "graphile_worker.jobs")).toBe(0);
    });

    it("generate: off, ready_for_review still produces the first generation", async () => {
      const off = appWithPolicy({ generate: false, debounceSeconds: null });
      await deliver(
        off,
        "pull_request",
        pullRequestPayload({ action: "opened", draft: true }),
      );
      const before = Date.now();
      const res = await deliver(
        off,
        "pull_request",
        pullRequestPayload({ action: "ready_for_review", draft: false }),
      );
      expect(res.status).toBe(200);
      expect(await countRows(harness, "generation")).toBe(1);
      const delta = await jobRunAtDelta(before);
      expect(delta).toBeLessThan(15_000);
    });

    it("generate off: checkpoints known draft reviews without enqueueing", async () => {
      const off = appWithPolicy({ generate: false, debounceSeconds: null });
      await deliver(
        off,
        "pull_request",
        pullRequestPayload({ action: "opened", draft: true }),
      );
      const res = await deliver(
        off,
        "pull_request_review",
        pullRequestReviewPayload(),
      );
      expect(res.status).toBe(200);
      expect(await countRows(harness, "checkpoint")).toBe(1);
      expect(await countRows(harness, "graphile_worker.jobs")).toBe(0);
    });

    it("generate off: reopens closed drafts so later events can proceed", async () => {
      const off = appWithPolicy({ generate: false, debounceSeconds: null });
      await deliver(
        off,
        "pull_request",
        pullRequestPayload({ action: "opened", draft: true }),
      );
      await deliver(
        off,
        "pull_request",
        pullRequestPayload({ action: "closed", draft: true }),
      );
      const res = await deliver(
        off,
        "pull_request",
        pullRequestPayload({ action: "reopened", draft: true }),
      );
      expect(res.status).toBe(200);
      const prs = await harness.raw("select * from pull_request");
      expect(prs).toHaveLength(1);
      expect(prs[0]?.["state"]).toBe("open");
      // Still a draft under generate: off, no generation, no job.
      expect(await countRows(harness, "generation")).toBe(0);
      expect(await countRows(harness, "graphile_worker.jobs")).toBe(0);
    });

    it("generate off: a late draft reopen after a close is skipped and logged", async () => {
      const capture = testLogging({ LOG_LEVEL: "debug" });
      const earlier = "2026-09-20T10:00:00Z";
      const later = "2026-09-20T10:05:00Z";
      const off = createApp({
        logger: capture.logger,
        handle: harness.handle,
        webhookSecret: SECRET,
        auth: DUMMY_AUTH,
        ...UNUSED_INSTALLATION_DEPS,
        ...LISTED_OWNER_DEPS,
        draftPolicy: { generate: false, debounceSeconds: null },
      });
      await deliver(
        off,
        "pull_request",
        pullRequestPayload({
          action: "opened",
          draft: true,
          updatedAt: earlier,
        }),
      );
      await deliver(
        off,
        "pull_request",
        pullRequestPayload({ action: "closed", draft: true, updatedAt: later }),
      );
      const res = await deliver(
        off,
        "pull_request",
        pullRequestPayload({
          action: "reopened",
          draft: true,
          updatedAt: earlier,
        }),
      );

      expect(res.status).toBe(200);
      const prs = await harness.raw("select state from pull_request");
      expect(prs).toEqual([{ state: "closed" }]);
      const skipped = capture
        .lines()
        .find(
          (line) =>
            line["msg"] === "webhook event older than the stored row, skipped",
        );
      expect(skipped?.["action"]).toBe("reopened");
    });

    it("replaces pending draft damping with one short ready_for_review job", async () => {
      const damped = appWithPolicy({ generate: true, debounceSeconds: 900 });
      await deliver(
        damped,
        "pull_request",
        pullRequestPayload({ action: "opened", draft: true }),
      );
      await harness.raw("update generation set status = 'succeeded'");
      await harness.raw("delete from graphile_worker.jobs");
      await deliver(
        damped,
        "pull_request",
        pullRequestPayload({ action: "synchronize", draft: true }),
      );
      const before = Date.now();
      await deliver(
        damped,
        "pull_request",
        pullRequestPayload({ action: "ready_for_review", draft: false }),
      );
      const delta = await jobRunAtDelta(before); // asserts exactly one job
      expect(delta).toBeGreaterThan(5_000);
      expect(delta).toBeLessThan(15_000);
    });

    it("uses the normal review window even when draft pushes are damped", async () => {
      const damped = appWithPolicy({ generate: true, debounceSeconds: 900 });
      await deliver(
        damped,
        "pull_request",
        pullRequestPayload({ action: "opened", draft: true }),
      );
      await harness.raw("update generation set status = 'succeeded'");
      await harness.raw("delete from graphile_worker.jobs");
      const before = Date.now();
      await deliver(damped, "pull_request_review", pullRequestReviewPayload());
      const delta = await jobRunAtDelta(before);
      expect(delta).toBeLessThan(65_000);
    });

    it("generate: off, a review on a KNOWN non-draft PR still enqueues", async () => {
      const off = appWithPolicy({ generate: false, debounceSeconds: null });
      await deliver(
        off,
        "pull_request",
        pullRequestPayload({ action: "opened", draft: false }),
      );
      await harness.raw("delete from graphile_worker.jobs");
      const res = await deliver(
        off,
        "pull_request_review",
        pullRequestReviewPayload(),
      );
      expect(res.status).toBe(200);
      expect(await countRows(harness, "graphile_worker.jobs")).toBe(1);
    });
  });
});

describe("POST /api/webhooks/github, github_app_authorization", () => {
  const keyProvider = createKeyProvider();
  let app: ApiApp;

  beforeEach(() => {
    app = createApp({
      logger: testLogger(),
      handle: harness.handle,
      webhookSecret: SECRET,
      auth: buildAuthDeps(keyProvider),
      ...UNUSED_INSTALLATION_DEPS,
      ...LISTED_OWNER_DEPS,
    });
  });

  function makeRevokedPayload(senderId: number): Record<string, unknown> {
    return { action: "revoked", sender: { id: senderId, login: "octocat" } };
  }

  it("revoked wipes the user's session, token and grant and answers 200", async () => {
    await seedSignIn(harness.handle, keyProvider);
    await seedApiToken(harness.handle, keyProvider, AccessLevels.READ);

    const res = await deliver(
      app,
      "github_app_authorization",
      makeRevokedPayload(REVIEWER_ID),
    );

    expect(res.status).toBe(200);
    expect(await countRows(harness, "auth_session")).toBe(0);
    expect(await countRows(harness, "api_token")).toBe(0);
    expect(await countRows(harness, "github_grant")).toBe(0);
  });

  it("an unsigned revoked delivery is 401 and deletes nothing", async () => {
    await seedSignIn(harness.handle, keyProvider);

    const res = await deliver(
      app,
      "github_app_authorization",
      makeRevokedPayload(REVIEWER_ID),
      { secret: "wrong-secret" },
    );

    expect(res.status).toBe(401);
    expect(await countRows(harness, "auth_session")).toBe(1);
    expect(await countRows(harness, "github_grant")).toBe(1);
  });

  it("the wiped cookie answers 401 on the next request", async () => {
    const { cookie } = await seedSignIn(harness.handle, keyProvider);

    await deliver(
      app,
      "github_app_authorization",
      makeRevokedPayload(REVIEWER_ID),
    );
    const res = await app.request("/api/version", {
      headers: { Cookie: `__Host-mergebrief_session=${cookie}` },
    });

    expect(res.status).toBe(401);
  });
});

describe("webhook delivery dedup", () => {
  const openedPayload = pullRequestPayload({ action: "opened" });
  let app: ApiApp;
  let capture: ReturnType<typeof testLogging>;

  /** A GitHub that confirms every purge: the installation is gone. */
  function makeGoneGitHub(): FakeGitHub {
    const gone = makeFakeGitHub();
    const installationId = brandInstallationId(BigInt(INSTALLATION_ID));
    gone.removeInstallation(installationId);
    return gone;
  }

  beforeEach(() => {
    const goneGitHub = makeGoneGitHub();
    capture = testLogging({ LOG_LEVEL: "debug" });
    app = createApp({
      logger: capture.logger,
      handle: harness.handle,
      webhookSecret: SECRET,
      auth: DUMMY_AUTH,
      ...buildFakeInstallationDeps(goneGitHub),
      ...LISTED_OWNER_DEPS,
    });
  });

  async function pinJobRunAt(): Promise<void> {
    await harness.raw("update graphile_worker.jobs set run_at = $1", [
      PINNED_RUN_AT.toISOString(),
    ]);
  }

  async function readJobRunAts(): Promise<number[]> {
    const jobs = await harness.raw("select run_at from graphile_worker.jobs");
    return jobs.map((job) => epochMs(job["run_at"]));
  }

  function findDuplicateLines(): ReturnType<typeof capture.lines> {
    return capture
      .lines()
      .filter((line) => line["evt"] === "webhook.delivery.duplicate");
  }

  it("skips a delivery already processed and logs it at debug", async () => {
    await deliver(app, "pull_request", openedPayload, {
      deliveryId: "delivery-first",
    });
    await pinJobRunAt();

    const res = await deliver(app, "pull_request", openedPayload, {
      deliveryId: "delivery-first",
    });

    expect(res.status).toBe(200);
    expect(await readJobRunAts()).toEqual([PINNED_RUN_AT.getTime()]);
    expect(findDuplicateLines()).toEqual([
      expect.objectContaining({ level: "debug", deliveryId: "delivery-first" }),
    ]);
  });

  it("skips a replay whose delivery id header was changed", async () => {
    await deliver(app, "pull_request", openedPayload, {
      deliveryId: "delivery-original",
    });
    await pinJobRunAt();

    await deliver(app, "pull_request", openedPayload, {
      deliveryId: "delivery-forged",
    });

    expect(await readJobRunAts()).toEqual([PINNED_RUN_AT.getTime()]);
    expect(findDuplicateLines()).toHaveLength(1);
  });

  it("records a delivery whose id header is malformed and still dedups it", async () => {
    await deliver(app, "pull_request", openedPayload, {
      deliveryId: "not a delivery id",
    });
    await pinJobRunAt();

    await deliver(app, "pull_request", openedPayload, {
      deliveryId: "not a delivery id",
    });

    expect(
      await harness.raw("select delivery_id from webhook_delivery"),
    ).toEqual([{ delivery_id: null }]);
    expect(await readJobRunAts()).toEqual([PINNED_RUN_AT.getTime()]);
  });

  it("records nothing for an ignored event", async () => {
    await deliver(
      app,
      "pull_request",
      pullRequestPayload({ action: "labeled" }),
    );

    expect(await countRows(harness, "webhook_delivery")).toBe(0);
  });

  it("processes a delivery recorded past the dedup window", async () => {
    const signature = await sign(SECRET, JSON.stringify(openedPayload));
    const signatureDigest = digestWebhookSignature(signature);
    const pastWindow = new Date(Date.now() - DELIVERY_DEDUP_TTL_MS - HOUR_MS);
    await createWebhookDeliveryStore(harness.handle).recordDelivery(
      { signatureDigest },
      pastWindow,
    );

    const res = await deliver(app, "pull_request", openedPayload);

    expect(res.status).toBe(200);
    expect(await countRows(harness, "graphile_worker.jobs")).toBe(1);
    expect(findDuplicateLines()).toEqual([]);
  });

  it("processes concurrent duplicates to one idempotent end state", async () => {
    const responses = await Promise.all([
      deliver(app, "pull_request", openedPayload),
      deliver(app, "pull_request", openedPayload),
    ]);

    expect(responses.map((res) => res.status)).toEqual([200, 200]);
    expect(await countRows(harness, "pull_request")).toBe(1);
    expect(await countRows(harness, "generation")).toBe(1);
    expect(await countRows(harness, "graphile_worker.jobs")).toBe(1);
    expect(await countRows(harness, "webhook_delivery")).toBe(1);
  });

  it("a second identical revoke still wipes a fresh sign-in", async () => {
    const keyProvider = createKeyProvider();
    const revoked = { action: "revoked", sender: { id: REVIEWER_ID } };
    await seedSignIn(harness.handle, keyProvider);
    await deliver(app, "github_app_authorization", revoked);
    await seedSignIn(harness.handle, keyProvider);

    const res = await deliver(app, "github_app_authorization", revoked);

    expect(res.status).toBe(200);
    expect(await countRows(harness, "auth_session")).toBe(0);
    expect(await countRows(harness, "github_grant")).toBe(0);
    expect(await countRows(harness, "webhook_delivery")).toBe(0);
  });

  it("a second identical repo removal still purges the re-added repo", async () => {
    const removed = installationRepositoriesPayload({
      action: "removed",
      removedRepoIds: [REPO_ID],
    });
    await seedPullRequest(harness, BigInt(REPO_ID), 2);
    await deliver(app, "installation_repositories", removed);
    await seedPullRequest(harness, BigInt(REPO_ID), 3);

    const res = await deliver(app, "installation_repositories", removed);

    expect(res.status).toBe(200);
    expect(await countRows(harness, "pull_request")).toBe(0);
    expect(await countRows(harness, "webhook_delivery")).toBe(0);
  });

  it("a second identical uninstall still purges the tenant", async () => {
    const deleted = installationPayload("deleted");
    await seedPullRequest(harness, BigInt(REPO_ID), 2);
    await deliver(app, "installation", deleted);
    await seedPullRequest(harness, BigInt(REPO_ID), 3);

    const res = await deliver(app, "installation", deleted);

    expect(res.status).toBe(200);
    expect(await countRows(harness, "pull_request")).toBe(0);
    expect(await countRows(harness, "webhook_delivery")).toBe(0);
  });

  /** Its own database, and a GitHub that confirms the uninstall. */
  async function openOwnApp(): Promise<{
    own: Awaited<ReturnType<typeof openPerTestPglite>>;
    ownApp: ApiApp;
  }> {
    const own = await openPerTestPglite();
    const goneGitHub = makeGoneGitHub();
    const ownApp = createApp({
      logger: capture.logger,
      handle: own.handle,
      webhookSecret: SECRET,
      auth: DUMMY_AUTH,
      ...buildFakeInstallationDeps(goneGitHub),
      ...LISTED_OWNER_DEPS,
    });
    return { own, ownApp };
  }

  it("answers 500 and writes nothing when the seen-set cannot be read", async () => {
    const { own, ownApp } = await openOwnApp();
    await own.raw(
      "alter table webhook_delivery rename to webhook_delivery_gone",
    );

    const res = await deliver(ownApp, "pull_request", openedPayload);

    expect(res.status).toBe(500);
    expect(
      await own.raw("select count(*)::int as n from pull_request"),
    ).toEqual([{ n: 0 }]);
    const failures = capture
      .lines()
      .filter((line) => line["evt"] === "webhook.dispatch.fail");
    expect(failures).toHaveLength(1);
  });

  it("answers 500 when the record fails, and a redelivery then processes", async () => {
    const { own, ownApp } = await openOwnApp();
    await own.raw(
      "create function refuse_delivery() returns trigger language plpgsql as $$ begin raise exception 'refused'; end $$",
    );
    await own.raw(
      "create trigger refuse_delivery before insert on webhook_delivery for each row execute function refuse_delivery()",
    );
    const failed = await deliver(ownApp, "pull_request", openedPayload);
    await own.raw("drop trigger refuse_delivery on webhook_delivery");

    const redelivered = await deliver(ownApp, "pull_request", openedPayload);

    expect(failed.status).toBe(500);
    expect(redelivered.status).toBe(200);
    expect(
      await own.raw("select count(*)::int as n from webhook_delivery"),
    ).toEqual([{ n: 1 }]);
    expect(findDuplicateLines()).toEqual([]);
  });

  it("processes a revoke redelivered after its first attempt failed", async () => {
    const { own, ownApp } = await openOwnApp();
    await seedSignIn(own.handle, createKeyProvider());
    const revoked = { action: "revoked", sender: { id: REVIEWER_ID } };
    await own.raw("alter table auth_session rename to auth_session_gone");
    const failed = await deliver(ownApp, "github_app_authorization", revoked);
    await own.raw("alter table auth_session_gone rename to auth_session");

    const redelivered = await deliver(
      ownApp,
      "github_app_authorization",
      revoked,
    );

    expect(failed.status).toBe(500);
    expect(redelivered.status).toBe(200);
    expect(
      await own.raw("select count(*)::int as n from github_grant"),
    ).toEqual([{ n: 0 }]);
  });

  it("processes an uninstall redelivered after its first purge failed", async () => {
    const { own, ownApp } = await openOwnApp();
    await seedPullRequest(own, BigInt(REPO_ID), 2);
    await own.raw("alter table audit_log rename to audit_log_gone");
    const failed = await deliver(
      ownApp,
      "installation",
      installationPayload("deleted"),
    );
    await own.raw("alter table audit_log_gone rename to audit_log");

    const redelivered = await deliver(
      ownApp,
      "installation",
      installationPayload("deleted"),
    );

    expect(failed.status).toBe(500);
    expect(redelivered.status).toBe(200);
    expect(
      await own.raw("select count(*)::int as n from pull_request"),
    ).toEqual([{ n: 0 }]);
  });

  it("processes a redelivery of a delivery whose dispatch failed", async () => {
    const { own, ownApp } = await openOwnApp();
    await own.raw("alter table pull_request rename to pull_request_poisoned");
    const failed = await deliver(ownApp, "pull_request", openedPayload);
    await own.raw("alter table pull_request_poisoned rename to pull_request");

    const redelivered = await deliver(ownApp, "pull_request", openedPayload);

    expect(failed.status).toBe(500);
    expect(redelivered.status).toBe(200);
    expect(
      await own.raw("select count(*)::int as n from pull_request"),
    ).toEqual([{ n: 1 }]);
  });
});

describe("webhook event logging", () => {
  function appWithCapture(handle: AppDatabase = harness.handle) {
    const capture = testLogging();
    const app = createApp({
      logger: capture.logger,
      handle,
      webhookSecret: SECRET,
      auth: DUMMY_AUTH,
      ...UNUSED_INSTALLATION_DEPS,
      ...LISTED_OWNER_DEPS,
    });
    return { app, capture };
  }

  it("warns on invalid signatures with delivery and request correlation ids", async () => {
    const { app, capture } = appWithCapture();
    const res = await deliver(
      app,
      "pull_request",
      pullRequestPayload({ action: "opened" }),
      {
        secret: "wrong-secret",
        deliveryId: "delivery-verify-1",
      },
    );
    expect(res.status).toBe(401);
    const line = capture
      .lines()
      .find((l) => l["evt"] === "webhook.verify.fail");
    expect(line?.["level"]).toBe("warn");
    expect(line?.["deliveryId"]).toBe("delivery-verify-1");
    expect(typeof line?.["reqId"]).toBe("string");
  });

  it("dispatch failure emits webhook.dispatch.fail at error with deliveryId", async () => {
    const own = await openPerTestPglite();
    const { app, capture } = appWithCapture(own.handle);
    // Poison the write path AFTER app construction: the dispatch's first
    // tenant write hits a missing table and throws, the route's 500 path.
    await own.raw("alter table pull_request rename to pull_request_poisoned");
    const res = await deliver(
      app,
      "pull_request",
      pullRequestPayload({ action: "opened" }),
      {
        deliveryId: "delivery-dispatch-1",
      },
    );
    expect(res.status).toBe(500);
    const line = capture
      .lines()
      .find((l) => l["evt"] === "webhook.dispatch.fail");
    expect(line?.["level"]).toBe("error");
    expect(line?.["deliveryId"]).toBe("delivery-dispatch-1");
    expect(line?.["err"]).toBeDefined();
  });

  it("drops an out-of-format x-github-delivery instead of binding it", async () => {
    const { app, capture } = appWithCapture();
    // Pre-auth endpoint: the header is attacker-controlled, so anything
    // outside GitHub's GUID shape (charset/length) must not ride the logs.
    const res = await deliver(
      app,
      "pull_request",
      pullRequestPayload({ action: "opened" }),
      {
        secret: "wrong-secret",
        deliveryId: `evil"}${"x".repeat(300)}`,
      },
    );
    expect(res.status).toBe(401);
    const line = capture
      .lines()
      .find((l) => l["evt"] === "webhook.verify.fail");
    expect(line).toBeDefined();
    expect(line?.["deliveryId"]).toBeUndefined();
    expect(capture.lines().every((l) => JSON.stringify(l).length < 1000)).toBe(
      true,
    );
  });

  it("an enqueue logs generation.enqueue with the delivery and its pair", async () => {
    const { app, capture } = appWithCapture();
    const res = await deliver(
      app,
      "pull_request",
      pullRequestPayload({ action: "opened" }),
      { deliveryId: "delivery-enqueue-1" },
    );

    expect(res.status).toBe(200);
    const [prRow] = await harness.raw("select id from pull_request");
    const line = capture
      .lines()
      .find((entry) => entry["evt"] === "generation.enqueue");
    expect(line).toMatchObject({
      level: "info",
      deliveryId: "delivery-enqueue-1",
      repoId: String(REPO_ID),
      prNumber: 2,
      prId: String(prRow?.["id"]),
      headSha: HEAD_SHA,
    });
    expect(typeof line?.["reqId"]).toBe("string");
  });

  it("a delivery that queues nothing writes no generation.enqueue line", async () => {
    const { app, capture } = appWithCapture();
    await deliver(
      app,
      "pull_request",
      pullRequestPayload({ action: "closed" }),
    );
    // A review reaches the trigger, which keeps the closed state and queues
    // nothing: the line must follow `queued`, not `applied`.
    const res = await deliver(
      app,
      "pull_request_review",
      pullRequestReviewPayload(),
      { deliveryId: "delivery-review-closed" },
    );

    expect(res.status).toBe(200);
    const enqueued = capture
      .lines()
      .filter((entry) => entry["evt"] === "generation.enqueue");
    expect(enqueued).toEqual([]);
    const [job] = await harness.raw(
      "select count(*)::int as n from graphile_worker.jobs",
    );
    expect(job?.["n"]).toBe(0);
  });
});
