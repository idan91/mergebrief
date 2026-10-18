// Migration 0061 data test, same posture as migration-0059.test.ts: the body
// rewrite must run against PRE-migration rows. Applies 0000 to 0060 raw, seeds
// brief bodies carrying the old intent bucket key, applies 0061, and reads the
// bodies back.
import { IntentCheckSchema } from "brief-core/types";
import { describe, expect, it } from "vitest";
import {
  applyMigrationFile,
  MIGRATION_REPLAY_TIMEOUT_MS,
  pgliteBefore,
} from "./helpers";

interface ArtifactRow {
  readonly head_sha: string;
  readonly body: string;
  readonly byte_size: number;
  readonly body_version: number | null;
}

const MASKED_ITEM = {
  intent: "claims the flaky test is fixed but only skips it",
  quote: "fixes the flaky widget test",
  sourceUrl: "",
  groupIds: ["g1"],
  acknowledged: false,
};

const DASH = "\u2014";
const INTENT_LINE = [
  `\u26a0 intent check issues: doneButUnstated item "adds a helper" references unknown group "t1" ${DASH} pruned`,
  `claimedButUnachieved item "claims the flaky test is fixed" has no valid group anchor ${DASH} dropped`,
].join("; ");
const SOLE_ISSUE_LINE = `\u26a0 intent check issues: claimedButUnachieved item "masks the retry" has no valid group anchor ${DASH} dropped`;
const QUOTING_LINE =
  '\u26a0 grouping issues: group "g1" summary quotes claimedButUnachieved item "x"';

function makeIntentCheck(): Record<string, unknown> {
  return {
    ticketUrls: [],
    ticketTitles: [],
    specificity: "precise",
    scopeNote: "",
    accomplished: [],
    statedButMissing: [],
    doneButUnstated: [],
    deviations: [],
    claimedButUnachieved: [MASKED_ITEM],
  };
}

function quoteSql(value: string): string {
  return value.replaceAll("'", "''");
}

function buildBriefInsert(
  headSha: string,
  headIndex: number,
  body: object,
  bodyVersion: string,
): string {
  const text = quoteSql(JSON.stringify(body, null, 2));
  return `
    insert into brief (installation_id, pull_request_id, base_sha, head_sha, head_index,
                       commit_count, provider, model, effort, body, byte_size, used_group_ids, body_version)
    select 4242, id, 'base', '${headSha}', ${headIndex}, 1, 'anthropic', 'claude', 'high',
           '${text}', 1, '{}', ${bodyVersion}
    from pull_request where pr_number = ${headSha === "plain" ? 8 : 7};
  `;
}

async function seedArtifacts(
  client: Awaited<ReturnType<typeof pgliteBefore>>["client"],
): Promise<void> {
  const migrated = {
    changeGroups: [{ id: "g1" }],
    generationWarnings: [INTENT_LINE, SOLE_ISSUE_LINE, QUOTING_LINE],
    intentCheck: makeIntentCheck(),
  };
  const quoting = {
    changeGroups: [
      { id: "g1", summary: "Renames claimedButUnachieved in the schema" },
    ],
    generationWarnings: [QUOTING_LINE],
  };
  const plain = { changeGroups: [{ id: "g1" }], generationWarnings: null };

  await client.exec(`
    insert into pull_request (installation_id, repo_id, pr_number, repo_slug, state)
    values (4242, 99, 7, 'acme/widgets', 'open'),
           (4242, 99, 8, 'acme/widgets', 'open');
    ${buildBriefInsert("migrated", 1, migrated, "1")}
    ${buildBriefInsert("quoting", 2, quoting, "1")}
    ${buildBriefInsert("plain", 1, plain, "null")}
  `);
}

async function readArtifacts(
  client: Awaited<ReturnType<typeof pgliteBefore>>["client"],
): Promise<Record<string, ArtifactRow>> {
  const result = await client.query<ArtifactRow>(`
    select head_sha, body, byte_size, body_version from brief
  `);
  return Object.fromEntries(result.rows.map((row) => [row.head_sha, row]));
}

describe(
  "migration 0061 masked fixes key",
  { timeout: MIGRATION_REPLAY_TIMEOUT_MS },
  () => {
    it("moves the intent bucket key and leaves a readable intent check", async () => {
      const { client, target } = await pgliteBefore("0061_");
      await seedArtifacts(client);

      await applyMigrationFile(client, target);

      const rows = await readArtifacts(client);
      const brief = rows["migrated"];
      const body = JSON.parse(brief?.body ?? "{}");
      expect(body.intentCheck.maskedFixes).toEqual([MASKED_ITEM]);
      expect(body.intentCheck).not.toHaveProperty("claimedButUnachieved");
      expect(IntentCheckSchema.safeParse(body.intentCheck).success).toBe(true);
      expect(brief?.body_version).toBe(2);
      expect(brief?.byte_size).toBe(Buffer.byteLength(brief?.body ?? ""));
    });

    it("renames bucket items inside the intent check warning line only", async () => {
      const { client, target } = await pgliteBefore("0061_");
      await seedArtifacts(client);

      await applyMigrationFile(client, target);

      const rows = await readArtifacts(client);
      const warnings = JSON.parse(
        rows["migrated"]?.body ?? "{}",
      ).generationWarnings;
      expect(warnings).toEqual([
        INTENT_LINE.replace(
          "; claimedButUnachieved item",
          "; maskedFixes item",
        ),
        SOLE_ISSUE_LINE.replace(
          ": claimedButUnachieved item",
          ": maskedFixes item",
        ),
        QUOTING_LINE,
      ]);
    });

    it("leaves bodies that only quote the old key untouched", async () => {
      const { client, target } = await pgliteBefore("0061_");
      await seedArtifacts(client);
      const before = await readArtifacts(client);

      await applyMigrationFile(client, target);

      const after = await readArtifacts(client);
      expect(after["quoting"]).toEqual(before["quoting"]);
      expect(after["plain"]).toEqual(before["plain"]);
    });

    it("changes nothing when applied a second time", async () => {
      const { client, target } = await pgliteBefore("0061_");
      await seedArtifacts(client);
      await applyMigrationFile(client, target);
      const once = await readArtifacts(client);

      await applyMigrationFile(client, target);

      expect(await readArtifacts(client)).toEqual(once);
    });
  },
);
