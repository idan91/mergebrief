// Integration tests for the webhook trust boundary: `app.request()` against
// `createApp` over the persistence PGlite harness (real migrations + the
// graphile_worker stub). Payloads are minimal inline builders satisfying
// github's Zod schemas (shapes cribbed from that package's fixtures — not
// imported), signed for real with `@octokit/webhooks-methods`. No network,
// no LLM, no real Postgres.
import { sign } from "@octokit/webhooks-methods";
import type { Hono } from "hono";
import {
  envKeyProvider,
  forTenant,
  isRepoId,
  parseTenantContext,
  PrState,
  type RepoId,
} from "persistence";
import { createPgliteHarness, type PgliteHarness } from "persistence/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AuthDeps } from "../src/lib";
import { createApp } from "../src/lib";

const SECRET = "test-webhook-secret";

// Dummy auth deps: the webhook tests never exercise the OAuth/session routes,
// but `createApp` now requires the bundle. A throwaway 32-byte key keeps the
// crypto seam constructible; nothing here triggers a token seal.
const DUMMY_AUTH: AuthDeps = {
  oauthClientId: "test-client-id",
  oauthClientSecret: "test-client-secret",
  keyProvider: envKeyProvider({ SESSION_KEY_V1: Buffer.alloc(32).toString("base64") }),
  sessionKeyRef: "SESSION_KEY_V1",
  publicBaseUrl: "http://localhost:3000",
  cookieSecure: false,
};
const INSTALLATION_ID = 987654;
const REPO_ID = 186853002;
const OTHER_REPO_ID = 186853003;
const HEAD_SHA = "ec26c3e57ca3a959ca5aad62de7213c562f8c821";

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
}

/** Sign `payload` (over the exact serialized bytes) and POST it. */
async function deliver(
  app: Hono,
  eventName: string,
  payload: unknown,
  options?: DeliverOptions,
): Promise<Response> {
  const body = JSON.stringify(payload);
  const signature = options?.signature ?? (await sign(options?.secret ?? SECRET, body));
  return app.request("/api/webhooks/github", {
    method: "POST",
    headers: {
      "x-hub-signature-256": signature,
      "x-github-event": eventName,
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
}): Record<string, unknown> {
  return {
    action: input.action,
    number: input.prNumber ?? 2,
    installation: { id: INSTALLATION_ID },
    repository: { id: input.repoId ?? REPO_ID, full_name: "acme/widgets" },
    pull_request: {
      title: "Update the README with new information.",
      head: { sha: HEAD_SHA },
      base: { sha: "f95f852bd8fca8fcc58a9a2d6c842781e32a215e" },
      draft: input.draft ?? false,
      user: input.authorLogin === null ? null : { login: input.authorLogin ?? "author-octocat" },
      ...(input.merged === undefined ? {} : { merged: input.merged }),
    },
  };
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
  await forTenant(harness.handle, ctx).pullRequests.upsert({
    repoId: brandRepoId(repoId),
    prNumber,
    repoSlug: "acme/widgets",
    state: PrState.OPEN,
  });
}

async function countRows(harness: PgliteHarness, table: string): Promise<number> {
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


// Conversation port stub (BRIEF-25): these tests never exercise the
// conversation read; a hit here is a test bug.
const unusedConversationPort = {
  fetchPullRequestConversation: async () => {
    throw new Error("conversation port must not be called in this suite");
  },
};

describe("POST /api/webhooks/github", () => {
  let harness: PgliteHarness;
  let app: Hono;

  beforeEach(async () => {
    harness = await createPgliteHarness();
    app = createApp({ handle: harness.handle, webhookSecret: SECRET, auth: DUMMY_AUTH, github: unusedConversationPort });
  });

  afterEach(async () => {
    await harness.close();
  });

  it("pull_request opened with a valid signature → 200 + PR row + generation row + debounced job", async () => {
    const before = Date.now();
    const res = await deliver(app, "pull_request", pullRequestPayload({ action: "opened" }));
    expect(res.status).toBe(200);

    const prs = await harness.raw("select * from pull_request");
    expect(prs).toHaveLength(1);
    expect(prs[0]?.["state"]).toBe("open");
    expect(prs[0]?.["repo_slug"]).toBe("acme/widgets");

    const generations = await harness.raw("select * from generation");
    expect(generations).toHaveLength(1);
    expect(generations[0]?.["kind"]).toBe("brief");
    expect(generations[0]?.["status"]).toBe("queued");
    expect(generations[0]?.["head_sha"]).toBe(HEAD_SHA);
    expect(generations[0]?.["baseline_sha"]).toBeNull();

    const jobs = await harness.raw("select * from graphile_worker.jobs");
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.["task_identifier"]).toBe("generate");
    expect(jobs[0]?.["job_key"]).toBe(`generate:${String(prs[0]?.["id"])}`);
    expect(jobs[0]?.["payload"]).toEqual({
      installation_id: String(INSTALLATION_ID),
      pull_request_id: String(prs[0]?.["id"]),
      head_sha: HEAD_SHA,
    });
    const runAt = epochMs(jobs[0]?.["run_at"]);
    expect(runAt - before).toBeGreaterThan(55_000);
    expect(runAt - before).toBeLessThan(65_000);
  });

  it("persists draft + author_login from a pull_request event (BRIEF-43)", async () => {
    const res = await deliver(
      app,
      "pull_request",
      pullRequestPayload({ action: "opened", draft: true, authorLogin: "author-octocat" }),
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
          pullRequestPayload({ action: "opened", draft: true, authorLogin: "author-octocat" }),
        )
      ).status,
    ).toBe(200);
    // A review carries neither draft nor author — must preserve both, exactly
    // as it preserves base_sha.
    expect(
      (await deliver(app, "pull_request_review", pullRequestReviewPayload())).status,
    ).toBe(200);
    const prs = await harness.raw("select * from pull_request");
    expect(prs).toHaveLength(1);
    expect(prs[0]?.["draft"]).toBe(true);
    expect(prs[0]?.["author_login"]).toBe("author-octocat");
  });

  it("a pull_request event with user:null (deleted author) preserves the stored author_login", async () => {
    // Ingest with a known author.
    expect(
      (
        await deliver(
          app,
          "pull_request",
          pullRequestPayload({ action: "opened", draft: true, authorLogin: "author-octocat" }),
        )
      ).status,
    ).toBe(200);
    // Redeliver the same PR's synchronize with `pull_request.user: null` —
    // GitHub's deleted-author shape. The omitted parse field must preserve the
    // stored login (pinning webhook.ts's `=== undefined` spread against a
    // future `?? null` refactor), while draft still updates normally.
    expect(
      (
        await deliver(
          app,
          "pull_request",
          pullRequestPayload({ action: "synchronize", draft: false, authorLogin: null }),
        )
      ).status,
    ).toBe(200);
    const prs = await harness.raw("select * from pull_request");
    expect(prs).toHaveLength(1);
    expect(prs[0]?.["author_login"]).toBe("author-octocat");
    expect(prs[0]?.["draft"]).toBe(false);
  });

  it("ready_for_review flips draft false idempotently (route + webhook converge)", async () => {
    expect(
      (
        await deliver(
          app,
          "pull_request",
          pullRequestPayload({ action: "opened", draft: true, authorLogin: "author-octocat" }),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await deliver(
          app,
          "pull_request",
          pullRequestPayload({ action: "ready_for_review", draft: false, authorLogin: "author-octocat" }),
        )
      ).status,
    ).toBe(200);
    const prs = await harness.raw("select * from pull_request");
    expect(prs).toHaveLength(1);
    expect(prs[0]?.["draft"]).toBe(false);
    expect(prs[0]?.["author_login"]).toBe("author-octocat");
  });

  it("converted_to_draft flips draft true WITHOUT touching generation or enqueueing (state-only)", async () => {
    // A ready PR converted back to draft must re-enter own-draft state — but
    // entering draft has no regen rationale (BRIEF-43 reviewer round 3): the
    // event is state-only. The generation projection for the already-briefed
    // head must be untouched (no phantom `queued`, no attempts bump) and no
    // job may be scheduled beyond the one the earlier trigger left.
    expect(
      (
        await deliver(
          app,
          "pull_request",
          pullRequestPayload({ action: "opened", draft: false, authorLogin: "author-octocat" }),
        )
      ).status,
    ).toBe(200);
    const genBefore = await harness.raw("select status, attempts from generation");
    const jobsBefore = await harness.raw("select id, run_at from graphile_worker.jobs");
    expect(genBefore).toHaveLength(1);
    expect(jobsBefore).toHaveLength(1);

    expect(
      (
        await deliver(
          app,
          "pull_request",
          pullRequestPayload({ action: "converted_to_draft", draft: true, authorLogin: "author-octocat" }),
        )
      ).status,
    ).toBe(200);
    const prs = await harness.raw("select * from pull_request");
    expect(prs).toHaveLength(1);
    expect(prs[0]?.["draft"]).toBe(true);
    expect(prs[0]?.["author_login"]).toBe("author-octocat");
    // Generation projection untouched (status AND attempts), job list identical
    // (same single job, run_at NOT pushed — no debounce replace happened).
    expect(await harness.raw("select status, attempts from generation")).toEqual(genBefore);
    expect(await harness.raw("select id, run_at from graphile_worker.jobs")).toEqual(jobsBefore);

    // Redelivery converges (idempotent no-op when already draft).
    expect(
      (
        await deliver(
          app,
          "pull_request",
          pullRequestPayload({ action: "converted_to_draft", draft: true, authorLogin: "author-octocat" }),
        )
      ).status,
    ).toBe(200);
    const again = await harness.raw("select draft from pull_request");
    expect(again).toHaveLength(1);
    expect(again[0]?.["draft"]).toBe(true);
  });

  it("redelivery is idempotent: one PR row, attempts++, one job with a pushed run_at", async () => {
    const payload = pullRequestPayload({ action: "opened" });
    expect((await deliver(app, "pull_request", payload)).status).toBe(200);
    const firstJobs = await harness.raw("select run_at from graphile_worker.jobs");
    const firstRunAt = epochMs(firstJobs[0]?.["run_at"]);

    await new Promise((resolve) => setTimeout(resolve, 25));
    expect((await deliver(app, "pull_request", payload)).status).toBe(200);

    expect(await countRows(harness, "pull_request")).toBe(1);
    const generations = await harness.raw("select attempts from generation");
    expect(generations).toHaveLength(1);
    expect(generations[0]?.["attempts"]).toBe(1);

    const jobs = await harness.raw("select run_at from graphile_worker.jobs");
    expect(jobs).toHaveLength(1);
    expect(epochMs(jobs[0]?.["run_at"])).toBeGreaterThan(firstRunAt);
  });

  it("pull_request_review submitted on a KNOWN PR → 200 + queued generation (gap-filler)", async () => {
    await seedPullRequest(harness, BigInt(REPO_ID), 2);
    const res = await deliver(app, "pull_request_review", pullRequestReviewPayload());
    expect(res.status).toBe(200);
    expect(await countRows(harness, "pull_request")).toBe(1);
    expect(await countRows(harness, "generation")).toBe(1);
    expect(await countRows(harness, "graphile_worker.jobs")).toBe(1);
  });

  it("pull_request_review on an UNKNOWN PR → 200 no-op (no phantom open row)", async () => {
    const res = await deliver(app, "pull_request_review", pullRequestReviewPayload());
    expect(res.status).toBe(200);
    expect(await countRows(harness, "pull_request")).toBe(0);
    expect(await countRows(harness, "generation")).toBe(0);
    expect(await countRows(harness, "graphile_worker.jobs")).toBe(0);
    // The unknown-PR skip extends to the checkpoint (FK needs the parent).
    expect(await countRows(harness, "checkpoint")).toBe(0);
  });

  it("submitted review writes the checkpoint pinned to review.commit_id, not head.sha (BRIEF-23)", async () => {
    await seedPullRequest(harness, BigInt(REPO_ID), 2);
    const viewedHead = "1111111111111111111111111111111111111111";
    // head.sha stays HEAD_SHA (a push landed mid-review) — commit_id must win.
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

  it("Bot-authored review skips the checkpoint but still re-queues generation (BRIEF-23)", async () => {
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

  it("out-of-order review deliveries keep the newest submission (BRIEF-23 monotonic)", async () => {
    await seedPullRequest(harness, BigInt(REPO_ID), 2);
    const newerSha = "2222222222222222222222222222222222222222";
    const olderSha = "3333333333333333333333333333333333333333";
    await deliver(
      app,
      "pull_request_review",
      pullRequestReviewPayload({ commitId: newerSha, submittedAt: "2026-07-07T12:05:00Z" }),
    );
    // The older submission arrives late (redelivery / out-of-order).
    const res = await deliver(
      app,
      "pull_request_review",
      pullRequestReviewPayload({ commitId: olderSha, submittedAt: "2026-07-07T12:00:00Z" }),
    );
    expect(res.status).toBe(200);
    const rows = await harness.raw("select last_submitted_sha from checkpoint");
    expect(rows).toHaveLength(1);
    expect(String(rows[0]?.["last_submitted_sha"])).toBe(newerSha);
  });

  it("review redelivery is idempotent — one checkpoint row, same values (BRIEF-23)", async () => {
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
    const res = await deliver(app, "pull_request", pullRequestPayload({ action: "opened" }), {
      secret: "wrong-secret",
    });
    expect(res.status).toBe(401);
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
      headers: { "x-github-event": "pull_request", "content-type": "application/json" },
      body,
    });
    expect(res.status).toBe(401);
    expect(await countRows(harness, "pull_request")).toBe(0);
  });

  it("signed but malformed handled payload → 400, nothing written", async () => {
    const res = await deliver(app, "pull_request", { action: "opened", number: 2 });
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

    const prs = await harness.raw("select state, closed_at, purge_after from pull_request");
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
      (await deliver(app, "pull_request", pullRequestPayload({ action: "opened" }))).status,
    ).toBe(200);
    expect(
      (await deliver(app, "pull_request", pullRequestPayload({ action: "closed" }))).status,
    ).toBe(200);
    expect(
      (await deliver(app, "pull_request", pullRequestPayload({ action: "synchronize" }))).status,
    ).toBe(200);

    const prs = await harness.raw("select state, closed_at from pull_request");
    expect(prs).toHaveLength(1);
    expect(prs[0]?.["state"]).toBe("closed");
    expect(prs[0]?.["closed_at"]).not.toBeNull();
  });

  it("an explicit reopened event transitions a closed PR back to open", async () => {
    expect(
      (await deliver(app, "pull_request", pullRequestPayload({ action: "opened" }))).status,
    ).toBe(200);
    expect(
      (await deliver(app, "pull_request", pullRequestPayload({ action: "closed" }))).status,
    ).toBe(200);
    expect(
      (await deliver(app, "pull_request", pullRequestPayload({ action: "reopened" }))).status,
    ).toBe(200);

    const prs = await harness.raw("select state, closed_at, purge_after from pull_request");
    expect(prs[0]?.["state"]).toBe("open");
    expect(prs[0]?.["closed_at"]).toBeNull();
    expect(prs[0]?.["purge_after"]).toBeNull();
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

    const res = await deliver(app, "installation", installationPayload("deleted"));
    expect(res.status).toBe(200);

    expect(await countRows(harness, "pull_request")).toBe(0);
    const audits = await harness.raw(
      "select action, target_type, installation_id from audit_log where action = 'delete'",
    );
    expect(audits).toHaveLength(1);
    expect(audits[0]?.["target_type"]).toBe("installation");
    expect(String(audits[0]?.["installation_id"])).toBe(String(INSTALLATION_ID));
  });

  it("installation created → 200, no writes", async () => {
    const res = await deliver(app, "installation", installationPayload("created"));
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
      installationRepositoriesPayload({ action: "removed", removedRepoIds: [REPO_ID] }),
    );
    expect(res.status).toBe(200);

    const remaining = await harness.raw("select repo_id from pull_request");
    expect(remaining).toHaveLength(1);
    expect(String(remaining[0]?.["repo_id"])).toBe(String(OTHER_REPO_ID));
    // The repo purge emitted its own delete audit entry.
    const audits = await harness.raw("select target_type from audit_log where action = 'delete'");
    expect(audits).toHaveLength(1);
    expect(audits[0]?.["target_type"]).toBe("repo");
  });

  it("ignored event (pull_request labeled) → 200, no writes", async () => {
    const res = await deliver(app, "pull_request", pullRequestPayload({ action: "labeled" }));
    expect(res.status).toBe(200);
    expect(await countRows(harness, "pull_request")).toBe(0);
    expect(await countRows(harness, "graphile_worker.jobs")).toBe(0);
  });
});
