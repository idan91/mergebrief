import {
  createArtifactStore,
  createTenantRepository,
  isInstallationId,
  isRepoId,
  parseTenantContext,
  PrStates,
  type RepoId,
} from "persistence";
import { createPgliteHarness, type PgliteHarness } from "persistence/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NotFound } from "../../../../shared-errors/api-error";
import readsController from "./controller";
import type { ReadsControllerDeps } from "./types";

let harness: PgliteHarness;
let deps: ReadsControllerDeps;
let repoId: RepoId;

const PR_NUMBER = 7;

beforeAll(async () => {
  harness = await createPgliteHarness();
  const installationId = 555n;
  if (!isInstallationId(installationId)) {
    throw new Error("unbrandable installation id");
  }
  const ctx = parseTenantContext({ installationId });
  const rawRepoId = 4321n;
  if (!isRepoId(rawRepoId)) {
    throw new Error("unbrandable repo id");
  }
  repoId = rawRepoId;
  const tenant = createTenantRepository(harness.handle, ctx);
  const artifacts = createArtifactStore(harness.handle, ctx);
  deps = { tenant, artifacts };
  const pr = await tenant.pullRequests.upsert({
    repoId,
    prNumber: PR_NUMBER,
    repoSlug: "acme/app",
    title: "Add thing",
    state: PrStates.OPEN,
  });
  const written = await artifacts.briefs.write({
    pullRequestId: pr.id,
    baseSha: "base1",
    headSha: "head1",
    headIndex: 0,
    commitCount: 1,
    provider: "anthropic",
    model: "claude",
    effort: "high",
    body: '{"stored":"verbatim"}',
  });
  if (!written.ok) {
    throw new Error("fixture brief write failed");
  }
});
afterAll(async () => {
  await harness.close();
});

describe("readsController", () => {
  it("returns a stored brief body verbatim", async () => {
    const body = await readsController.readBrief(deps, {
      repoId,
      prNumber: PR_NUMBER,
      base: "base1",
      head: "head1",
    });
    expect(body).toBe('{"stored":"verbatim"}');
  });

  it("throws NotFound for a span with no stored artifact", async () => {
    await expect(
      readsController.readBrief(deps, {
        repoId,
        prNumber: PR_NUMBER,
        base: "base1",
        head: "other-head",
      }),
    ).rejects.toBeInstanceOf(NotFound);
    await expect(
      readsController.readMarks(deps, {
        repoId,
        prNumber: PR_NUMBER,
        baseline: "base1",
        head: "head1",
      }),
    ).rejects.toBeInstanceOf(NotFound);
  });

  it("throws NotFound for an unknown PR before touching artifacts", async () => {
    await expect(
      readsController.readDelta(deps, {
        repoId,
        prNumber: 999,
        baseline: "base1",
        head: "head1",
      }),
    ).rejects.toBeInstanceOf(NotFound);
    await expect(
      readsController.readNarrative(deps, {
        repoId,
        prNumber: 999,
        prevHead: "head0",
        head: "head1",
      }),
    ).rejects.toBeInstanceOf(NotFound);
  });
});
