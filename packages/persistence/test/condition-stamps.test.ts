import { describe, expect, it } from "vitest";
import {
  createTenantRepository,
  parseTenantContext,
  readConditionStamps,
} from "../src/index";
import { PrStates } from "types/pull-requests";
import { GATE_CTX, GATE_REPO_ID, registerSharedPglite } from "./helpers";

const shared = registerSharedPglite();

const OTHER_CTX = parseTenantContext({ installationId: 999n });
const DIGEST = "a".repeat(64);
const EDITED_DIGEST = "b".repeat(64);

async function seedPullRequest() {
  const repo = createTenantRepository(shared.handle, GATE_CTX);
  const row = await repo.pullRequests.upsert({
    repoId: GATE_REPO_ID,
    prNumber: 7,
    state: PrStates.OPEN,
  });
  return { repo, row };
}

describe("readConditionStamps", () => {
  it("reads an unstamped row as no stamps", async () => {
    const { row } = await seedPullRequest();

    expect(readConditionStamps(row)).toEqual({});
  });
});

describe("stampReviewRequestedMet", () => {
  it("stamps once and keeps the first time", async () => {
    const { repo, row } = await seedPullRequest();

    const first = await repo.pullRequests.stampReviewRequestedMet(row.id);
    const stamped = await repo.pullRequests.getById(row.id);
    const second = await repo.pullRequests.stampReviewRequestedMet(row.id);
    const after = await repo.pullRequests.getById(row.id);

    expect(first).toEqual(stamped);
    expect(second).toEqual(after);
    expect(after?.reviewRequestedMetAt).toEqual(stamped?.reviewRequestedMetAt);
    expect(after?.rowVersion).toBe(row.rowVersion + 1);
    expect(stamped && readConditionStamps(stamped).reviewRequestedMetAt).toBe(
      stamped?.reviewRequestedMetAt,
    );
  });

  it("writes nothing on a row outside the scope", async () => {
    const { row } = await seedPullRequest();
    const other = createTenantRepository(shared.handle, OTHER_CTX);

    const stamped = await other.pullRequests.stampReviewRequestedMet(row.id);

    expect(stamped).toBeUndefined();
    const rows = await shared.harness.raw(
      "select review_requested_met_at from pull_request",
    );
    expect(rows).toEqual([{ review_requested_met_at: null }]);
  });
});

describe("stampPathsMet", () => {
  it("stamps a digest once and stamps again under an edited one", async () => {
    const { repo, row } = await seedPullRequest();

    const first = await repo.pullRequests.stampPathsMet(row.id, DIGEST);
    const repeat = await repo.pullRequests.stampPathsMet(row.id, DIGEST);
    const edited = await repo.pullRequests.stampPathsMet(row.id, EDITED_DIGEST);
    const after = await repo.pullRequests.getById(row.id);

    const versions = [first, repeat, edited].map((stamp) => stamp?.rowVersion);
    expect(versions).toEqual([
      row.rowVersion + 1,
      row.rowVersion + 1,
      row.rowVersion + 2,
    ]);
    expect(edited).toEqual(after);
    expect(after && readConditionStamps(after).pathsMetDigest).toBe(
      EDITED_DIGEST,
    );
  });

  it("refuses a paths stamp with only one of its pair", async () => {
    await seedPullRequest();

    await expect(
      shared.harness.raw("update pull_request set paths_met_at = now()"),
    ).rejects.toThrow("pull_request_paths_met_shape");
  });
});
