import {
  createArtifactStore,
  createGenerationProjection,
  createTenantRepository,
  isInstallationId,
  isRepoId,
  parseTenantContext,
  PrStates,
  type RepoId,
} from "persistence";
import { createPgliteHarness, type PgliteHarness } from "persistence/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AllowedRepo } from "../installation-resolver";
import pullsController from "./controller";
import type { PullsControllerDeps } from "./types";

let harness: PgliteHarness;
beforeAll(async () => {
  harness = await createPgliteHarness();
});
afterAll(async () => {
  await harness.close();
});

function brandRepoId(value: bigint): RepoId {
  if (!isRepoId(value)) {
    throw new Error("unbrandable repo id");
  }
  return value;
}

describe("pullsController.listPulls", () => {
  it("lists rows for the allowed repos and shapes fail-closed views", async () => {
    const installationId = 4242n;
    if (!isInstallationId(installationId)) {
      throw new Error("unbrandable installation id");
    }
    const ctx = parseTenantContext({ installationId });
    const tenant = createTenantRepository(harness.handle, ctx);
    const repoId = brandRepoId(9101n);
    await tenant.pullRequests.upsert({
      repoId,
      prNumber: 7,
      repoSlug: "acme/app",
      title: "Add thing",
      authorLogin: "octocat",
      state: PrStates.OPEN,
    });
    const deps: PullsControllerDeps = {
      tenant,
      artifacts: createArtifactStore(harness.handle, ctx),
      generations: createGenerationProjection(harness.handle, ctx),
    };
    const allowed = new Map<RepoId, AllowedRepo>([
      [
        repoId,
        { installationId: ctx.installationId, fullName: "acme/app-current" },
      ],
    ]);

    const body = await pullsController.listPulls(deps, {
      allowed,
      viewerLogin: "octocat",
      limit: 50,
    });

    expect(body.pulls).toHaveLength(1);
    const view = body.pulls[0];
    expect(view?.repoId).toBe("9101");
    // The verified slug from the allowed set wins over the stored one.
    expect(view?.repoSlug).toBe("acme/app-current");
    expect(view?.viewerIsAuthor).toBe(true);
    // List path carries no permissions block: push capability fails closed,
    // so resolve affordance is authorship-only.
    expect(view?.viewerCanResolve).toBe(true);
    expect(view?.briefAvailable).toBe(false);
    expect(view?.generation).toBeNull();

    // A repo outside the allowed set never surfaces.
    const empty = await pullsController.listPulls(deps, {
      allowed: new Map<RepoId, AllowedRepo>(),
      viewerLogin: null,
      limit: 50,
    });
    expect(empty.pulls).toEqual([]);
  });
});
