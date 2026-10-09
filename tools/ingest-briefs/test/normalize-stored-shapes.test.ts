// The one-off stored-shape migration, against a migrated in-memory database.
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ArtifactIssueCodes,
  readStoredBrief,
  STORED_BODY_VERSION,
} from "brief-core/artifact";
import {
  createArtifactStore,
  createTenantRepository,
  isRepoId,
  isReviewerId,
  type OwnerContext,
  type PullRequestRowId,
} from "persistence";
import { createPgliteHarness, type PgliteHarness } from "persistence/testing";
import { PrStates } from "types/pull-requests";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  normalizeBriefFiles,
  normalizeStoredShapes,
  type SqlRunner,
} from "../src/normalize-stored-shapes";

const FIXTURES = new URL(
  "../../../apps/web/e2e/fixtures/briefs/",
  import.meta.url,
);
const FIRST_BRIEF = "mergebrief-e2e-fixture-1_1_11111111.brief.json";
const SECOND_BRIEF = "mergebrief-e2e-fixture-1_2_22222222.brief.json";
const NARRATIVE = "mergebrief-e2e-fixture-1_2_22222222.revision-narrative.json";
const ORIGIN = { provider: "anthropic", model: "m", effort: "medium" };
const LEGACY_ISSUES = new Set<string>([
  ArtifactIssueCodes.LEGACY_MEMBERSHIP,
  ArtifactIssueCodes.MINTED_GROUP_ID,
]);

interface SeededIds {
  legacyBriefId: bigint;
}

function readFixture(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(new URL(name, FIXTURES), "utf8"));
}

/** The fixture with membership as group lists and no group ids. */
function makeLegacyBody(): string {
  const brief = readFixture(FIRST_BRIEF);
  const chunks = brief["chunks"] as { id: string; changeGroupId?: string }[];
  const groups = brief["changeGroups"] as { id?: string }[];
  const legacyGroups = groups.map(({ id, ...group }) => ({
    ...group,
    coreChunkIds: chunks
      .filter((chunk) => chunk.changeGroupId === id)
      .map((chunk) => chunk.id),
  }));
  const legacyChunks = chunks.map(({ changeGroupId: _id, ...chunk }) => chunk);
  return JSON.stringify({
    ...brief,
    changeGroups: legacyGroups,
    chunks: legacyChunks,
  });
}

function listLegacyIssues(body: string): string[] {
  const read = readStoredBrief(body);
  if (!read.ok) {
    throw new Error("expected a readable body");
  }
  return read.value.issues
    .map((issue) => issue.code)
    .filter((code) => LEGACY_ISSUES.has(code));
}

async function seed(harness: PgliteHarness): Promise<SeededIds> {
  const ownerUserId = 555n;
  const repoId = 424242n;
  if (!isReviewerId(ownerUserId) || !isRepoId(repoId)) {
    throw new Error("unbrandable fixture id");
  }
  const ctx: OwnerContext = { ownerUserId };
  const row = await createTenantRepository(
    harness.handle,
    ctx,
  ).pullRequests.upsert({
    repoId,
    prNumber: 1,
    repoSlug: "mergebrief/e2e-fixture",
    baseSha: "base",
    state: PrStates.OPEN,
  });
  const pullRequestId: PullRequestRowId = row.id;
  const store = createArtifactStore(harness.handle, ctx);

  const legacy = await store.briefs.write({
    ...ORIGIN,
    pullRequestId,
    baseSha: "base",
    headSha: "head1",
    headIndex: 1,
    commitCount: 1,
    body: makeLegacyBody(),
  });
  const current = await store.briefs.write({
    ...ORIGIN,
    pullRequestId,
    baseSha: "base",
    headSha: "head2",
    headIndex: 2,
    commitCount: 2,
    body: JSON.stringify(readFixture(SECOND_BRIEF)),
  });
  if (!legacy.ok || !current.ok) {
    throw new Error("brief seed failed");
  }

  await store.deltas.write({
    ...ORIGIN,
    pullRequestId,
    baselineSha: "head1",
    headSha: "head2",
    body: JSON.stringify({ summary: "an old delta" }),
  });
  await store.revisionNarratives.write({
    ...ORIGIN,
    pullRequestId,
    briefId: current.value.id,
    prevHeadSha: "head1",
    headSha: "head2",
    body: JSON.stringify(readFixture(NARRATIVE)),
  });
  await store.revisionNarratives.write({
    ...ORIGIN,
    pullRequestId,
    briefId: current.value.id,
    prevHeadSha: "head0",
    headSha: "head2",
    body: JSON.stringify({ overview: "an old narrative" }),
  });

  return { legacyBriefId: legacy.value.id };
}

async function readBriefRow(harness: PgliteHarness, id: bigint) {
  const [row] = await harness.raw(
    "select body, byte_size, body_version, session_group_count from brief where id = $1",
    [id],
  );
  if (row === undefined) {
    throw new Error("brief row missing");
  }
  return row;
}

function makeRunner(harness: PgliteHarness): SqlRunner {
  return { query: (text, params) => harness.raw(text, params) };
}

let harness: PgliteHarness;
beforeEach(async () => {
  harness = await createPgliteHarness();
});
afterEach(async () => {
  await harness.close();
});

describe("normalizeStoredShapes", () => {
  it("counts what it would change on a dry run and writes nothing", async () => {
    const { legacyBriefId } = await seed(harness);
    const before = await readBriefRow(harness, legacyBriefId);

    const summary = await normalizeStoredShapes(makeRunner(harness), {
      apply: false,
    });

    expect(summary).toEqual({
      briefs: { scanned: 2, rewritten: 1, unreadable: 0 },
      deltas: { scanned: 1, deleted: 1 },
      narratives: { scanned: 2, deleted: 1 },
    });
    expect(await readBriefRow(harness, legacyBriefId)).toEqual(before);
    expect(await harness.raw("select id from delta")).toHaveLength(1);
  });

  it("rewrites a legacy brief into the current shape", async () => {
    const { legacyBriefId } = await seed(harness);

    await normalizeStoredShapes(makeRunner(harness), { apply: true });

    const row = await readBriefRow(harness, legacyBriefId);
    const body = String(row["body"]);
    expect(listLegacyIssues(body)).toEqual([]);
    expect(row["byte_size"]).toBe(Buffer.byteLength(body, "utf8"));
    expect(row["body_version"]).toBe(STORED_BODY_VERSION);
    expect(row["session_group_count"]).toBe(2);
  });

  it("deletes a delta and a narrative the current readers refuse", async () => {
    await seed(harness);

    await normalizeStoredShapes(makeRunner(harness), { apply: true });

    expect(await harness.raw("select id from delta")).toEqual([]);
    expect(
      await harness.raw("select prev_head_sha from revision_narrative"),
    ).toEqual([{ prev_head_sha: "head1" }]);
  });

  it("changes nothing on a second run", async () => {
    await seed(harness);
    await normalizeStoredShapes(makeRunner(harness), { apply: true });

    const summary = await normalizeStoredShapes(makeRunner(harness), {
      apply: true,
    });

    expect(summary).toEqual({
      briefs: { scanned: 2, rewritten: 0, unreadable: 0 },
      deltas: { scanned: 0, deleted: 0 },
      narratives: { scanned: 1, deleted: 0 },
    });
  });
});

describe("normalizeBriefFiles", () => {
  it("rewrites a legacy brief file and leaves a current one alone", async () => {
    const dir = await mkdtemp(join(tmpdir(), "normalize-"));
    const legacyPath = join(dir, "legacy.brief.json");
    const currentPath = join(dir, "current.brief.json");
    const current = JSON.stringify(readFixture(SECOND_BRIEF));
    await writeFile(legacyPath, makeLegacyBody());
    await writeFile(currentPath, current);
    await writeFile(join(dir, "legacy.diffs.json"), "{}");

    const summary = await normalizeBriefFiles(dir, { apply: true });

    expect(summary).toEqual({ scanned: 2, rewritten: 1, unreadable: 0 });
    expect(listLegacyIssues(await readFile(legacyPath, "utf8"))).toEqual([]);
    expect(await readFile(currentPath, "utf8")).toBe(current);
  });
  it("fills an older intent check's missing alarm fields", async () => {
    const dir = await mkdtemp(join(tmpdir(), "normalize-"));
    const path = join(dir, "intent.brief.json");
    const item = { intent: "a", quote: "q", sourceUrl: "", groupIds: ["g1"] };
    const intentCheck = {
      ticketUrls: [],
      ticketTitles: [],
      specificity: "precise",
      scopeNote: "",
      accomplished: [item],
      statedButMissing: [],
      doneButUnstated: [],
    };
    await writeFile(
      path,
      JSON.stringify({ ...readFixture(SECOND_BRIEF), intentCheck }),
    );

    const summary = await normalizeBriefFiles(dir, { apply: true });

    const read = readStoredBrief(await readFile(path, "utf8"));
    if (!read.ok) {
      throw new Error("expected a readable body");
    }
    expect(summary.rewritten).toBe(1);
    expect(read.value.brief.intentCheck).toMatchObject({
      accomplished: [{ ...item, acknowledged: false }],
      deviations: [],
      claimedButUnachieved: [],
    });
  });
});
