// The ingest mapping over the committed e2e fixture set — the same files the
// browser suite serves, so the mapping and the seeding stay one behavior.
import { mkdtemp, writeFile, cp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createArtifactStore,
  createTenantRepository,
  isInstallationId,
  isRepoId,
  isReviewerId,
  PrState,
  type OwnerContext,
  type ReviewerId,
} from "persistence";
import { createPgliteHarness, type PgliteHarness } from "persistence/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ingestBriefDirectory, type RepoResolution } from "../src/ingest";

const FIXTURES = new URL(
  "../../../apps/web/e2e/fixtures/briefs",
  import.meta.url,
).pathname;

function brand<T extends bigint>(
  guard: (v: bigint) => v is T,
  value: bigint,
): T {
  if (!guard(value)) throw new Error("unbrandable fixture id");
  return value;
}

const OWNER: ReviewerId = brand(isReviewerId, 555n);
const OWNER_CTX: OwnerContext = { ownerUserId: OWNER };
const REPO_ID = brand(isRepoId, 424242n);

function staticResolve(): (
  slug: string,
  prNumber: number,
) => Promise<RepoResolution> {
  return async () => ({
    repoId: REPO_ID,
    lifecycle: { state: PrState.OPEN },
  });
}

let harness: PgliteHarness;
beforeEach(async () => {
  harness = await createPgliteHarness();
});
afterEach(async () => {
  await harness.close();
});

describe("ingestBriefDirectory", () => {
  it("maps the fixture set: PR row, verbatim briefs, anchored narrative, projected marks", async () => {
    const summary = await ingestBriefDirectory(harness.handle, {
      dir: FIXTURES,
      ctx: OWNER_CTX,
      resolveRepo: staticResolve(),
    });
    expect(summary.briefs).toBe(2);
    expect(summary.narratives).toBe(1);
    expect(summary.marks).toBe(1);
    expect(summary.deltas).toBe(0);
    expect(summary.unmapped).toEqual([]);
    // .comments.json / .diffs.json have no database home — reported.
    expect(
      summary.skipped.filter((n) => n.endsWith(".comments.json")),
    ).toHaveLength(2);
    expect(
      summary.skipped.filter((n) => n.endsWith(".diffs.json")),
    ).toHaveLength(2);

    const prs = await harness.raw(
      "select owner_user_id, installation_id, repo_slug, pr_number, state from pull_request",
    );
    expect(prs).toEqual([
      {
        owner_user_id: Number(OWNER),
        installation_id: null,
        repo_slug: "mergebrief/e2e-fixture",
        pr_number: 1,
        state: "open",
      },
    ]);

    // Body verbatim: byte-identical to the file.
    const repo = createTenantRepository(harness.handle, OWNER_CTX);
    const row = await repo.pullRequests.getByNumber(REPO_ID, 1);
    if (row === undefined) throw new Error("pr row missing");
    const store = createArtifactStore(harness.handle, OWNER_CTX);
    const briefs = await store.briefs.listForPullRequest(row.id);
    expect(briefs.map((brief) => brief.headIndex)).toEqual([1, 2]);
    const rev2 = briefs.find((brief) => brief.headIndex === 2);
    if (rev2 === undefined) throw new Error("rev2 missing");
    const stored = await store.briefs.get(row.id, rev2.baseSha, rev2.headSha);
    const fileBody = await readFile(
      join(FIXTURES, "mergebrief-e2e-fixture-1_2_22222222.brief.json"),
      "utf8",
    );
    expect(stored?.body).toBe(fileBody);

    // The narrative anchors to the rev-2 brief and keeps its SHA pair.
    const narratives = await harness.raw(
      "select brief_id, prev_head_sha, head_sha from revision_narrative",
    );
    expect(narratives).toHaveLength(1);
    expect(String(narratives[0]?.["brief_id"])).toBe(String(rev2.id));

    // Marks projected to coordinates-only (the CLI's context keys dropped).
    const marks = await harness.raw("select body from comparison_marks");
    expect(marks).toHaveLength(1);
    const body: unknown = JSON.parse(String(marks[0]?.["body"]));
    expect(Object.keys(body as object).toSorted()).toEqual([
      "baselineSha",
      "files",
      "headSha",
    ]);
  });

  it("is idempotent — a re-run rewrites the same rows in place", async () => {
    const options = {
      dir: FIXTURES,
      ctx: OWNER_CTX,
      resolveRepo: staticResolve(),
    };
    await ingestBriefDirectory(harness.handle, options);
    const summary = await ingestBriefDirectory(harness.handle, options);
    expect(summary.briefs).toBe(2);
    expect(await harness.raw("select id from pull_request")).toHaveLength(1);
    expect(await harness.raw("select id from brief")).toHaveLength(2);
    expect(await harness.raw("select id from revision_narrative")).toHaveLength(
      1,
    );
    expect(await harness.raw("select id from comparison_marks")).toHaveLength(
      1,
    );
  });

  it("targets an installation tenant when told to", async () => {
    const installationId = brand(isInstallationId, 987654n);
    await ingestBriefDirectory(harness.handle, {
      dir: FIXTURES,
      ctx: { installationId },
      resolveRepo: staticResolve(),
    });
    const prs = await harness.raw(
      "select owner_user_id, installation_id, source from pull_request",
    );
    expect(prs).toEqual([
      {
        owner_user_id: null,
        installation_id: Number(installationId),
        source: "app-installation",
      },
    ]);
  });

  it("maps the legacy revchanges alias, checkpoint comparisons, deltas, and reports unmapped briefs", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ingest-"));
    await cp(FIXTURES, dir, { recursive: true });
    const head = "22222222eeee3333ffff4444aaaa5555bbbb6666";
    const prev = "11111111ccccddddeeee1111222233334444aaaa";
    const checkpoint = "99999999ccccddddeeee1111222233334444aaaa";
    await writeFile(
      join(dir, "mergebrief-e2e-fixture-1_2_22222222.revchanges.json"),
      JSON.stringify({
        prevHeadSha: prev,
        headSha: head,
        prevIndex: 1,
        files: [
          {
            file: "src/app.ts",
            addedRanges: [{ start: 1, end: 3 }],
            removedRanges: [],
          },
        ],
      }),
    );
    await writeFile(
      join(
        dir,
        `mergebrief-e2e-fixture-1_checkpoint_${checkpoint.slice(0, 8)}-${head.slice(0, 8)}.comparison.json`,
      ),
      JSON.stringify({
        baselineSha: checkpoint,
        headSha: head,
        baselineLabel: "checkpoint",
        baselineIndex: 0,
        files: [],
      }),
    );
    await writeFile(
      join(
        dir,
        `mergebrief-e2e-fixture-1-${checkpoint.slice(0, 8)}..${head.slice(0, 8)}.delta.json`,
      ),
      JSON.stringify({
        summary: "delta",
        pr: { repo: "mergebrief/e2e-fixture", number: 1 },
        baselineSha: checkpoint,
        headSha: head,
        generation: { provider: "anthropic", model: "m", effort: "medium" },
      }),
    );
    await writeFile(
      join(dir, "legacy-preindex.brief.json"),
      JSON.stringify({ summary: "old format" }),
    );

    const summary = await ingestBriefDirectory(harness.handle, {
      dir,
      ctx: OWNER_CTX,
      resolveRepo: staticResolve(),
    });
    // The fixture comparison + the revchanges alias + the checkpoint file.
    expect(summary.marks).toBe(3);
    expect(summary.deltas).toBe(1);
    expect(summary.unmapped).toEqual(["legacy-preindex.brief.json"]);

    const spans = await harness.raw(
      "select baseline_sha from comparison_marks order by baseline_sha",
    );
    expect(spans.map((row) => row["baseline_sha"])).toContain(prev);
    expect(spans.map((row) => row["baseline_sha"])).toContain(checkpoint);
    expect(await harness.raw("select id from delta")).toHaveLength(1);
  });

  it("anchors a narrative to the brief at its own index, not the first at that head", async () => {
    // A base retarget leaves two briefs at ONE head with different indexes.
    // The narrative's group ids belong to exactly one of them.
    const dir = await mkdtemp(join(tmpdir(), "ingest-index-"));
    const head = "22222222eeee3333ffff4444aaaa5555bbbb6666";
    const oldBase = "11111111ccccddddeeee1111222233334444aaaa";
    const newBase = "33333333ccccddddeeee1111222233334444aaaa";
    const pr = { repo: "acme/widget", number: 1 };
    for (const [index, base] of [oldBase, newBase].entries()) {
      await writeFile(
        join(
          dir,
          `acme-widget-1_${String(index + 1)}_${head.slice(0, 8)}.brief.json`,
        ),
        JSON.stringify({
          summary: `brief ${String(index + 1)}`,
          pr,
          index: index + 1,
          commitRange: { base, head },
        }),
      );
    }
    await writeFile(
      join(dir, `acme-widget-1_2_${head.slice(0, 8)}.revision-narrative.json`),
      JSON.stringify({ pr, prevHeadSha: oldBase, headSha: head }),
    );

    const summary = await ingestBriefDirectory(harness.handle, {
      dir,
      ctx: OWNER_CTX,
      resolveRepo: staticResolve(),
    });

    expect(summary.briefs).toBe(2);
    expect(summary.narratives).toBe(1);
    const anchored = await harness.raw(
      "select b.head_index from revision_narrative n join brief b on b.id = n.brief_id",
    );
    expect(anchored).toEqual([{ head_index: 2 }]);
  });

  it("carries a pre-index brief when the resolution supplies its base", async () => {
    // Two real briefs in the migration set predate indexes: one brief per PR,
    // head under `pr.sha`, no commit range. They must land, not be reported
    // lost — the next PR deletes the only other reader.
    const dir = await mkdtemp(join(tmpdir(), "ingest-legacy-"));
    const head = "22222222eeee3333ffff4444aaaa5555bbbb6666";
    const base = "11111111ccccddddeeee1111222233334444aaaa";
    await writeFile(
      join(dir, "Idan91-flexer-55.brief.json"),
      JSON.stringify({
        summary: "an old brief",
        pr: {
          repo: "Idan91/flexer",
          number: 55,
          title: "a11y audit",
          sha: head,
        },
      }),
    );

    const summary = await ingestBriefDirectory(harness.handle, {
      dir,
      ctx: OWNER_CTX,
      resolveRepo: async () => ({
        repoId: REPO_ID,
        lifecycle: { state: PrState.OPEN },
        baseSha: base,
      }),
    });

    expect(summary.unmapped).toEqual([]);
    expect(summary.briefs).toBe(1);
    const rows = await harness.raw(
      "select base_sha, head_sha, head_index from brief",
    );
    expect(rows).toEqual([{ base_sha: base, head_sha: head, head_index: 1 }]);
  });

  it("resolves each pull request once, even when its briefs cannot be placed", async () => {
    // `resolveRepo` shells out to `gh`; a PR that cannot be placed must not
    // re-run it per brief, and must not report the same file twice.
    const dir = await mkdtemp(join(tmpdir(), "ingest-legacy-once-"));
    for (const sha of ["aaaa1111", "bbbb2222"]) {
      await writeFile(
        join(dir, `Idan91-website-9-${sha}.brief.json`),
        JSON.stringify({
          summary: "an old brief",
          pr: { repo: "Idan91/website", number: 9, sha: sha.repeat(5) },
        }),
      );
    }
    let calls = 0;

    const summary = await ingestBriefDirectory(harness.handle, {
      dir,
      ctx: OWNER_CTX,
      resolveRepo: async () => {
        calls += 1;
        return { repoId: REPO_ID, lifecycle: { state: PrState.OPEN } };
      },
    });

    expect(calls).toBe(1);
    expect(summary.unmapped).toHaveLength(2);
    expect(new Set(summary.unmapped).size).toBe(2);
  });

  it("reports a pre-index brief unmapped when no base SHA resolves", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ingest-legacy-nobase-"));
    await writeFile(
      join(dir, "Idan91-website-9.brief.json"),
      JSON.stringify({
        summary: "an old brief",
        pr: {
          repo: "Idan91/website",
          number: 9,
          sha: "ec17e007977594726e00775ed34dc4aaf0d73b65",
        },
      }),
    );

    const summary = await ingestBriefDirectory(harness.handle, {
      dir,
      ctx: OWNER_CTX,
      resolveRepo: staticResolve(),
    });

    expect(summary.unmapped).toEqual(["Idan91-website-9.brief.json"]);
    expect(summary.briefs).toBe(0);
    expect(await harness.raw("select id from brief")).toHaveLength(0);
  });

  it("refuses to guess when two slugs flatten to the same stem", async () => {
    // `a-b/c` #1 and `a/b-c` #1 both flatten to `a-b-c-1`, so a sidecar
    // naming that stem belongs to either PR. It is skipped, loudly, rather
    // than landing one PR's marks on the other's brief.
    const dir = await mkdtemp(join(tmpdir(), "ingest-collide-"));
    const head = "22222222eeee3333ffff4444aaaa5555bbbb6666";
    const base = "11111111ccccddddeeee1111222233334444aaaa";
    const slugs = ["a-b/c", "a/b-c"];
    for (const [offset, repo] of slugs.entries()) {
      await writeFile(
        join(dir, `pr${String(offset)}_1_${head.slice(0, 8)}.brief.json`),
        JSON.stringify({
          summary: `brief for ${repo}`,
          pr: { repo, number: 1 },
          index: 1,
          commitRange: { base, head },
        }),
      );
    }
    const comparison = `a-b-c-1_previous-brief_${base.slice(0, 8)}-${head.slice(0, 8)}.comparison.json`;
    await writeFile(
      join(dir, comparison),
      JSON.stringify({ baselineSha: base, headSha: head, files: [] }),
    );

    const summary = await ingestBriefDirectory(harness.handle, {
      dir,
      ctx: OWNER_CTX,
      // Distinct repos, same flattened stem.
      resolveRepo: async (slug: string) => ({
        repoId: brand(isRepoId, slug === "a-b/c" ? 111n : 222n),
        lifecycle: { state: PrState.OPEN },
      }),
    });

    expect(summary.briefs).toBe(2);
    expect(summary.marks).toBe(0);
    expect(summary.skipped).toContain(comparison);
    expect(await harness.raw("select id from comparison_marks")).toHaveLength(
      0,
    );
  });

  it("stops loudly on a corrupt brief body", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ingest-"));
    await cp(FIXTURES, dir, { recursive: true });
    await writeFile(
      join(dir, "mergebrief-e2e-fixture-1_3_33333333.brief.json"),
      "{not json",
    );
    await expect(
      ingestBriefDirectory(harness.handle, {
        dir,
        ctx: OWNER_CTX,
        resolveRepo: staticResolve(),
      }),
    ).rejects.toThrow("not valid JSON");
  });
});
