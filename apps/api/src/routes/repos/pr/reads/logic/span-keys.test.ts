import { STORED_BODY_VERSION } from "brief-core/artifact";
import {
  createArtifactStore,
  createTenantRepository,
  type PullRequestRow,
} from "persistence";
import { PrStates } from "types";
import { describe, expect, it } from "vitest";
import {
  brandInstallationId,
  brandRepoId,
} from "../../../../../../test/fixtures";
import { registerSharedPglite } from "../../../../../../test/shared-pglite";
import type { PullRequestAccess } from "../../../../../access/types";
import { SpanReadKinds, type SpanPair } from "../types";
import { createSpanKeyReader } from "./span-keys";

const CTX = { installationId: brandInstallationId(77n) };
const BASE = "a".repeat(40);
const OTHER_BASE = "b".repeat(40);
const HEAD_1 = "1".repeat(40);
const HEAD_2 = "2".repeat(40);
const SPAN_PAIR: SpanPair = { base: HEAD_1, head: HEAD_2 };
const REVERSED_PAIR: SpanPair = { base: HEAD_2, head: HEAD_1 };
const ORIGIN = { provider: "anthropic", model: "claude", effort: "high" };

const pglite = registerSharedPglite();

async function seedPullRequest(prNumber = 7): Promise<PullRequestRow> {
  return createTenantRepository(pglite.handle, CTX).pullRequests.upsert({
    repoId: brandRepoId(424242n),
    prNumber,
    repoSlug: "octo/hello",
    state: PrStates.OPEN,
    baseSha: BASE,
  });
}

function makeAccess(pr: PullRequestRow): PullRequestAccess {
  return { rowScope: CTX, row: pr } as unknown as PullRequestAccess;
}

async function seedBrief(pr: PullRequestRow, head: string, headIndex: number) {
  return createArtifactStore(pglite.handle, CTX).briefs.write({
    pullRequestId: pr.id,
    baseSha: BASE,
    headSha: head,
    headIndex,
    commitCount: 1,
    ...ORIGIN,
    bodyVersion: STORED_BODY_VERSION,
    body: "{}",
    usedGroupIds: [],
  });
}

async function seedMarks(pr: PullRequestRow, pair: SpanPair): Promise<void> {
  await createArtifactStore(pglite.handle, CTX).comparisonMarks.write({
    pullRequestId: pr.id,
    refs: { prevBase: BASE, newBase: OTHER_BASE },
    marks: { baselineSha: pair.base, headSha: pair.head, files: [] },
  });
}

async function seedNarrativeSkip(
  pr: PullRequestRow,
  pair: SpanPair,
  skipped: string,
): Promise<void> {
  const brief = await seedBrief(pr, pair.head, 2);
  await createArtifactStore(pglite.handle, CTX).revisionNarratives.write({
    pullRequestId: pr.id,
    briefId: brief.id,
    prevHeadSha: pair.base,
    headSha: pair.head,
    ...ORIGIN,
    bodyVersion: STORED_BODY_VERSION,
    body: JSON.stringify({ artifactKind: "revisionNarrativeSkipped", skipped }),
  });
}

async function seedDeltaSkip(
  pr: PullRequestRow,
  pair: SpanPair,
  skipped: string,
): Promise<void> {
  await createArtifactStore(pglite.handle, CTX).deltas.write({
    pullRequestId: pr.id,
    baselineSha: pair.base,
    headSha: pair.head,
    ...ORIGIN,
    bodyVersion: STORED_BODY_VERSION,
    body: JSON.stringify({ artifactKind: "deltaSkipped", skipped }),
  });
}

async function classify(pr: PullRequestRow, pair: SpanPair) {
  return createSpanKeyReader(pglite.handle).classify(makeAccess(pr), pair);
}

describe("createSpanKeyReader", () => {
  it("reads a marked pair as a span on the row's refs", async () => {
    const pr = await seedPullRequest();
    await seedMarks(pr, SPAN_PAIR);

    expect(await classify(pr, SPAN_PAIR)).toEqual({
      kind: SpanReadKinds.SPAN,
      refs: {
        prevBase: BASE,
        prevHead: HEAD_1,
        newBase: OTHER_BASE,
        newHead: HEAD_2,
      },
    });
    expect(await classify(pr, REVERSED_PAIR)).toEqual({
      kind: SpanReadKinds.COMPARE,
    });
  });

  it("reads a pair on the PR's base or a Brief's own pair as a compare", async () => {
    const pr = await seedPullRequest();
    await seedBrief(pr, HEAD_1, 1);
    await seedMarks(pr, { base: BASE, head: HEAD_1 });

    expect(await classify(pr, { base: BASE, head: HEAD_2 })).toEqual({
      kind: SpanReadKinds.COMPARE,
    });
    expect(await classify(pr, { base: BASE, head: HEAD_1 })).toEqual({
      kind: SpanReadKinds.COMPARE,
    });
  });

  it("refuses an unmarked pair the worker skipped as too large", async () => {
    const pr = await seedPullRequest();
    await seedNarrativeSkip(pr, SPAN_PAIR, "span too large");

    expect(await classify(pr, SPAN_PAIR)).toEqual({
      kind: SpanReadKinds.REFUSED,
    });
    expect(await classify(pr, REVERSED_PAIR)).toEqual({
      kind: SpanReadKinds.COMPARE,
    });
  });

  it("refuses an unmarked pair whose delta was skipped as too large", async () => {
    const pr = await seedPullRequest();
    await seedDeltaSkip(pr, SPAN_PAIR, "span-too-large");

    expect(await classify(pr, SPAN_PAIR)).toEqual({
      kind: SpanReadKinds.REFUSED,
    });
    expect(await classify(pr, REVERSED_PAIR)).toEqual({
      kind: SpanReadKinds.COMPARE,
    });
  });

  it("reads a skip for config or a cut output as a compare", async () => {
    const pr = await seedPullRequest();
    await seedNarrativeSkip(pr, SPAN_PAIR, "disabled by config");
    await seedDeltaSkip(pr, SPAN_PAIR, "output-cut");

    expect(await classify(pr, SPAN_PAIR)).toEqual({
      kind: SpanReadKinds.COMPARE,
    });
  });

  it("reads another pull request's marks row as no row", async () => {
    const pr = await seedPullRequest();
    const other = await seedPullRequest(8);
    await seedMarks(other, SPAN_PAIR);
    await seedDeltaSkip(other, REVERSED_PAIR, "span-too-large");

    expect(await classify(pr, SPAN_PAIR)).toEqual({
      kind: SpanReadKinds.COMPARE,
    });
    expect(await classify(pr, REVERSED_PAIR)).toEqual({
      kind: SpanReadKinds.COMPARE,
    });
  });
});
