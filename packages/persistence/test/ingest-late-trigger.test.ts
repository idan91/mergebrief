// A trigger with no time stamp, such as a review, says nothing about order: a
// late one must not move the PR back to a head it has left.
import { STORED_BODY_VERSION } from "brief-core/artifact";
import { beforeEach, describe, expect, it } from "vitest";
import { PrStates } from "types/pull-requests";
import { createArtifactStore } from "../src/stores/artifact-store";
import { createIngestRoutines } from "../src/stores/ingest";
import { parseTenantContext } from "../src/stores/scope-context";
import { createTenantRepository } from "../src/stores/tenant";
import type { PgliteHarness } from "../src/testing";
import { isRepoId, isReviewerId } from "../src/types";
import { brandWith, registerSharedPglite } from "./helpers";

const CTX = parseTenantContext({ installationId: 100n });
const REPO_ID = brandWith(isRepoId, 200n);
const OLDER_HEAD = "b".repeat(40);
const NEWER_HEAD = "c".repeat(40);
const UNSEEN_HEAD = "d".repeat(40);
const BASE_SHA = "f".repeat(40);
const MS_PER_MINUTE = 60_000;
const PULL_REQUEST = {
  repoId: REPO_ID,
  prNumber: 7,
  repoSlug: "acme/widgets",
  title: "feat: add widgets",
  baseSha: BASE_SHA,
  state: PrStates.OPEN,
};

describe("triggerGeneration with a late untimed trigger", () => {
  const shared = registerSharedPglite();
  let harness: PgliteHarness;

  beforeEach(() => {
    harness = shared.harness;
  });

  async function pushHead(headSha: string, at: string): Promise<void> {
    await createIngestRoutines(harness.handle, CTX).triggerGeneration({
      pullRequest: { ...PULL_REQUEST, githubUpdatedAt: new Date(at) },
      headSha,
    });
  }

  async function review(
    headSha: string,
    submission: { reviewSubmittedAt?: Date } = {},
  ): Promise<void> {
    await createIngestRoutines(harness.handle, CTX).triggerGeneration({
      pullRequest: PULL_REQUEST,
      headSha,
      ...submission,
    });
  }

  async function readJobHeads(): Promise<unknown[]> {
    const jobs = await harness.raw(
      "select payload->>'head_sha' as head from graphile_worker.jobs where task_identifier = 'generate'",
    );
    return jobs.map((job) => job["head"]);
  }

  it("keeps the waiting job on the newer head", async () => {
    await pushHead(OLDER_HEAD, "2026-11-01T10:00:00Z");
    await pushHead(NEWER_HEAD, "2026-11-01T10:00:30Z");

    await review(OLDER_HEAD);

    expect(await readJobHeads()).toEqual([NEWER_HEAD]);
  });

  it("leaves the older head's row as the newer push left it", async () => {
    await pushHead(OLDER_HEAD, "2026-11-01T10:00:00Z");
    await pushHead(NEWER_HEAD, "2026-11-01T10:00:30Z");
    const before = await harness.raw(
      "select head_sha, status from generation order by head_sha",
    );

    await review(OLDER_HEAD);

    const after = await harness.raw(
      "select head_sha, status from generation order by head_sha",
    );
    expect(after).toEqual(before);
  });

  it("still queues the delta a late review owes the current head", async () => {
    await pushHead(OLDER_HEAD, "2026-11-01T10:00:00Z");
    const pushed = await createIngestRoutines(
      harness.handle,
      CTX,
    ).triggerGeneration({
      pullRequest: {
        ...PULL_REQUEST,
        githubUpdatedAt: new Date("2026-11-01T10:00:30Z"),
      },
      headSha: NEWER_HEAD,
    });
    await createArtifactStore(harness.handle, CTX).briefs.write({
      pullRequestId: pushed.pullRequest.id,
      baseSha: BASE_SHA,
      headSha: NEWER_HEAD,
      headIndex: 2,
      commitCount: 2,
      provider: "stub",
      model: "stub",
      effort: "low",
      bodyVersion: STORED_BODY_VERSION,
      body: "{}",
      usedGroupIds: [],
    });
    await harness.raw("update generation set status = 'succeeded'");
    await harness.raw("truncate graphile_worker.jobs");
    await createTenantRepository(
      harness.handle,
      CTX,
    ).checkpoints.upsertOnSubmit({
      pullRequestId: pushed.pullRequest.id,
      reviewerId: brandWith(isReviewerId, 555n),
      lastSubmittedSha: OLDER_HEAD,
      submittedAt: new Date(),
    });

    await review(OLDER_HEAD);

    expect(await readJobHeads()).toEqual([NEWER_HEAD]);
  });

  it("queues the current head for a review of the current head", async () => {
    await pushHead(NEWER_HEAD, "2026-11-01T10:00:30Z");

    await review(NEWER_HEAD);

    expect(await readJobHeads()).toEqual([NEWER_HEAD]);
  });

  it("runs a head it has never seen, since its push may have been lost", async () => {
    await pushHead(OLDER_HEAD, "2026-11-01T10:00:00Z");

    await review(UNSEEN_HEAD);

    expect(await readJobHeads()).toEqual([UNSEEN_HEAD]);
  });

  it("keeps the current head for an older review of an unseen head", async () => {
    const reviewSubmittedAt = new Date(Date.now() - MS_PER_MINUTE);
    await pushHead(NEWER_HEAD, "2026-11-01T10:00:30Z");

    await review(UNSEEN_HEAD, { reviewSubmittedAt });

    expect(await readJobHeads()).toEqual([NEWER_HEAD]);
  });

  it("runs an unseen head whose review follows the current head", async () => {
    await pushHead(OLDER_HEAD, "2026-11-01T10:00:00Z");
    const reviewSubmittedAt = new Date(Date.now() + MS_PER_MINUTE);

    await review(UNSEEN_HEAD, { reviewSubmittedAt });

    expect(await readJobHeads()).toEqual([UNSEEN_HEAD]);
  });

  it("runs the named head on a PR with no current head", async () => {
    await review(OLDER_HEAD);

    expect(await readJobHeads()).toEqual([OLDER_HEAD]);
  });

  it("lets a timed push return to an older head", async () => {
    await pushHead(OLDER_HEAD, "2026-11-01T10:00:00Z");
    await pushHead(NEWER_HEAD, "2026-11-01T10:00:30Z");

    await pushHead(OLDER_HEAD, "2026-11-01T10:01:00Z");

    expect(await readJobHeads()).toEqual([OLDER_HEAD]);
  });
});
