// Use real signatures and schema-valid payloads over PGlite with a graphile queue stub.
// No network, model calls or real Postgres are needed at this boundary.
import { sign } from "@octokit/webhooks-methods";
import {
  createArtifactStore,
  createEnvKeyProvider,
  createTenantRepository,
  isPullRequestRowId,
  isRepoId,
  parseTenantContext,
  PrStates,
  type RepoId,
} from "persistence";
import { createPgliteHarness, type PgliteHarness } from "persistence/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp, type ApiApp, type AuthDeps } from "../src/index";
import { testLogger, testLogging } from "./logging";
import { INSTALLATION_ID, SECRET } from "./fixtures";

// Dummy auth deps: the webhook tests never exercise the OAuth/session routes,
// but `createApp` now requires the bundle. A throwaway 32-byte key keeps the
// crypto boundary constructible; nothing here triggers a token seal.
const DUMMY_AUTH: AuthDeps = {
  oauthClientId: "test-client-id",
  oauthClientSecret: "test-client-secret",
  keyProvider: createEnvKeyProvider({
    SESSION_KEY_V1: Buffer.alloc(32).toString("base64"),
  }),
  sessionKeyRef: "SESSION_KEY_V1",
  publicBaseUrl: "http://localhost:3000",
};
const REPO_ID = 186853002;
const OTHER_REPO_ID = 186853003;
const HEAD_SHA = "ec26c3e57ca3a959ca5aad62de7213c562f8c821";
const BASE_SHA = "f95f852bd8fca8fcc58a9a2d6c842781e32a215e";

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
}): Record<string, unknown> {
  const pullRequest: Record<string, unknown> = {
    title: "Update the README with new information.",
    head: { sha: input.headSha ?? HEAD_SHA },
    base: { sha: input.baseSha ?? BASE_SHA },
    draft: input.draft ?? false,
    user:
      input.authorLogin === null
        ? null
        : { login: input.authorLogin ?? "author-octocat" },
  };

  if (input.merged !== undefined) pullRequest["merged"] = input.merged;
  if (input.updatedAt !== undefined)
    pullRequest["updated_at"] = input.updatedAt;
  if (input.closedAt !== undefined) pullRequest["closed_at"] = input.closedAt;

  const payload: Record<string, unknown> = {
    action: input.action,
    number: input.prNumber ?? 2,
    installation: { id: INSTALLATION_ID },
    repository: { id: input.repoId ?? REPO_ID, full_name: "acme/widgets" },
    pull_request: pullRequest,
  };
  if (input.changes !== undefined) payload["changes"] = input.changes;

  return payload;
}

function pullRequestReviewPayload(review?: {
  commitId?: string;
  submittedAt?: string;
  userType?: string;
  userId?: number;
}): Record<string, unknown> {
  return {
    action: "submitted",
    installation: { id: INSTALLATION_ID },
    repository: { id: REPO_ID, full_name: "acme/widgets" },
    pull_request: {
      number: 2,
      title: "Update the README with new information.",
      head: { sha: HEAD_SHA },
    },
    review: {
      state: "approved",
      commit_id: review?.commitId ?? HEAD_SHA,
      submitted_at: review?.submittedAt ?? "2026-07-07T12:00:00Z",
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
  harness: PgliteHarness,
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
  harness: PgliteHarness,
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

// Conversation port stub: a call here is a test bug.
const unusedConversationPort = {
  fetchPullRequestConversation: async () => {
    throw new Error("conversation port must not be called in this suite");
  },
  listRepoCollaborators: async () => {
    throw new Error("collaborators port must not be called in this suite");
  },
  commitAttachment: async () => {
    throw new Error("attachment port must not be called in this suite");
  },
};

describe("POST /api/webhooks/github", () => {
  let harness: PgliteHarness;
  let app: ApiApp;

  beforeEach(async () => {
    harness = await createPgliteHarness();
    app = createApp({
      logger: testLogger(),
      handle: harness.handle,
      webhookSecret: SECRET,
      auth: DUMMY_AUTH,
      github: unusedConversationPort,
    });
  });

  afterEach(async () => {
    await harness.close();
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

  it("persists draft + author_login from a pull_request event", async () => {
    const res = await deliver(
      app,
      "pull_request",
      pullRequestPayload({
        action: "opened",
        draft: true,
        authorLogin: "author-octocat",
      }),
    );
    expect(res.status).toBe(200);
    const prs = await harness.raw("select * from pull_request");
    expect(prs).toHaveLength(1);
    expect(prs[0]?.["draft"]).toBe(true);
    expect(prs[0]?.["author_login"]).toBe("author-octocat");
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

  it("converges ready_for_review and route flips idempotently", async () => {
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

    // Redelivery converges (idempotent no-op when already draft).
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
    const again = await harness.raw("select draft from pull_request");
    expect(again).toHaveLength(1);
    expect(again[0]?.["draft"]).toBe(true);
  });

  it("redelivery increments attempts and keeps the single job's run_at", async () => {
    const payload = pullRequestPayload({ action: "opened" });
    expect((await deliver(app, "pull_request", payload)).status).toBe(200);
    const firstJobs = await harness.raw(
      "select run_at from graphile_worker.jobs",
    );
    const firstRunAt = epochMs(firstJobs[0]?.["run_at"]);

    await new Promise((resolve) => setTimeout(resolve, 25));
    expect((await deliver(app, "pull_request", payload)).status).toBe(200);

    expect(await countRows(harness, "pull_request")).toBe(1);
    const generations = await harness.raw("select attempts from generation");
    expect(generations).toHaveLength(1);
    expect(generations[0]?.["attempts"]).toBe(1);

    const jobs = await harness.raw("select run_at from graphile_worker.jobs");
    expect(jobs).toHaveLength(1);
    expect(epochMs(jobs[0]?.["run_at"])).toBe(firstRunAt);
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

  it("review redelivery is idempotent, one checkpoint row, same values", async () => {
    await seedPullRequest(harness, BigInt(REPO_ID), 2);
    const payload = pullRequestReviewPayload();
    await deliver(app, "pull_request_review", payload);
    const res = await deliver(app, "pull_request_review", payload);
    expect(res.status).toBe(200);
    const rows = await harness.raw("select last_submitted_sha from checkpoint");
    expect(rows).toHaveLength(1);
    expect(String(rows[0]?.["last_submitted_sha"])).toBe(HEAD_SHA);
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

    const prs = await harness.raw(
      "select state, closed_at, purge_after from pull_request",
    );
    expect(prs).toHaveLength(1);
    expect(prs[0]?.["state"]).toBe("closed");
    expect(prs[0]?.["closed_at"]).not.toBeNull();
    expect(prs[0]?.["purge_after"]).toBeNull();
    expect(await countRows(harness, "graphile_worker.jobs")).toBe(0);
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

    const prs = await harness.raw(
      "select state, closed_at, purge_after from pull_request",
    );
    expect(prs[0]?.["state"]).toBe("open");
    expect(prs[0]?.["closed_at"]).toBeNull();
    expect(prs[0]?.["purge_after"]).toBeNull();
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
      if (row === undefined) throw new Error("unreachable");
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

  it("pull_request closed with merged=true → merged state", async () => {
    await seedPullRequest(harness, BigInt(REPO_ID), 2);
    const res = await deliver(
      app,
      "pull_request",
      pullRequestPayload({ action: "closed", merged: true }),
    );
    expect(res.status).toBe(200);
    const prs = await harness.raw("select state from pull_request");
    expect(prs[0]?.["state"]).toBe("merged");
  });

  it("installation deleted → 200, tenant purged, delete audit entry appended", async () => {
    await seedPullRequest(harness, BigInt(REPO_ID), 2);
    expect(await countRows(harness, "pull_request")).toBe(1);

    const res = await deliver(
      app,
      "installation",
      installationPayload("deleted"),
    );
    expect(res.status).toBe(200);

    expect(await countRows(harness, "pull_request")).toBe(0);
    const audits = await harness.raw(
      "select operation, target_type, installation_id from audit_log where operation = 'delete'",
    );
    expect(audits).toHaveLength(1);
    expect(audits[0]?.["target_type"]).toBe("installation");
    expect(String(audits[0]?.["installation_id"])).toBe(
      String(INSTALLATION_ID),
    );
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

  it("installation_repositories removed → purges only that repo's PRs", async () => {
    await seedPullRequest(harness, BigInt(REPO_ID), 2);
    await seedPullRequest(harness, BigInt(OTHER_REPO_ID), 5);
    expect(await countRows(harness, "pull_request")).toBe(2);

    const res = await deliver(
      app,
      "installation_repositories",
      installationRepositoriesPayload({
        action: "removed",
        removedRepoIds: [REPO_ID],
      }),
    );
    expect(res.status).toBe(200);

    const remaining = await harness.raw("select repo_id from pull_request");
    expect(remaining).toHaveLength(1);
    expect(String(remaining[0]?.["repo_id"])).toBe(String(OTHER_REPO_ID));
    // The repo purge emitted its own delete audit entry.
    const audits = await harness.raw(
      "select target_type from audit_log where operation = 'delete'",
    );
    expect(audits).toHaveLength(1);
    expect(audits[0]?.["target_type"]).toBe("repo");
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
      if (!isPullRequestRowId(pullRequestId)) throw new Error("bad pr id");
      const ctx = parseTenantContext({ installationId: INSTALLATION_ID });
      const written = await createArtifactStore(
        harness.handle,
        ctx,
      ).briefs.write({
        pullRequestId,
        baseSha: BASE_SHA,
        headSha: HEAD_SHA,
        headIndex: 1,
        commitCount: 1,
        provider: "stub",
        model: "stub",
        effort: "low",
        body: "{}",
      });
      if (!written.ok) throw new Error(written.error.message);
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

    it("an opened redelivery queues nothing", async () => {
      await openWithStoredBrief();
      const res = await deliver(
        app,
        "pull_request",
        pullRequestPayload({ action: "opened" }),
      );
      expect(res.status).toBe(200);
      await expectQueued(false);
    });

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

    it("a review request queues nothing", async () => {
      await openWithStoredBrief();
      await deliver(
        app,
        "pull_request",
        pullRequestPayload({ action: "review_requested" }),
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
        github: unusedConversationPort,
        draftPolicy: policy,
      });
    }

    async function jobRunAtDelta(before: number): Promise<number> {
      const jobs = await harness.raw("select run_at from graphile_worker.jobs");
      expect(jobs).toHaveLength(1);
      return epochMs(jobs[0]?.["run_at"]) - before;
    }

    it("ready_for_review enqueues on the short flip window, not the normal one", async () => {
      const before = Date.now();
      const res = await deliver(
        app,
        "pull_request",
        pullRequestPayload({ action: "ready_for_review", draft: false }),
      );
      expect(res.status).toBe(200);
      const delta = await jobRunAtDelta(before);
      expect(delta).toBeGreaterThan(5_000);
      expect(delta).toBeLessThan(15_000);
    });

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
        github: unusedConversationPort,
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

describe("webhook event logging", () => {
  let harness: PgliteHarness;

  beforeEach(async () => {
    harness = await createPgliteHarness();
  });

  afterEach(async () => {
    await harness.close();
  });

  function appWithCapture() {
    const capture = testLogging();
    const app = createApp({
      logger: capture.logger,
      handle: harness.handle,
      webhookSecret: SECRET,
      auth: DUMMY_AUTH,
      github: unusedConversationPort,
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
    const { app, capture } = appWithCapture();
    // Poison the write path AFTER app construction: the dispatch's first
    // tenant write hits a missing table and throws, the route's 500 path.
    await harness.raw(
      "alter table pull_request rename to pull_request_poisoned",
    );
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

  it("a handled delivery's api.access line carries the reqId for correlation", async () => {
    const { app, capture } = appWithCapture();
    const res = await deliver(
      app,
      "pull_request",
      pullRequestPayload({ action: "opened" }),
    );
    expect(res.status).toBe(200);
    const line = capture.lines().find((l) => l["evt"] === "api.access");
    expect(line?.["status"]).toBe(200);
    expect(typeof line?.["reqId"]).toBe("string");
  });
});
