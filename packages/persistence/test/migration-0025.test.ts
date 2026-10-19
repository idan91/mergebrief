// Migration 0025 backfill test, same posture as migration-0024.test.ts: the
// transform must run against PRE-migration rows, which the shared harness (all
// migrations upfront, empty DB) cannot express. Applies 0000-0024 raw, seeds
// rows that only carry `action`, applies 0025, and asserts the history reads
// the same afterwards; a denial must not backfill as a success.
import { describe, expect, it } from "vitest";
import { AuditChannels, AuditOutcomes } from "../src/types";
import {
  applyMigrationFile,
  MIGRATION_REPLAY_TIMEOUT_MS,
  pgliteBefore,
  readCheckValues,
} from "./helpers";
import { AccessLevels } from "types/access-levels";

describe(
  "migration 0025 audit_log operation and outcome",
  { timeout: MIGRATION_REPLAY_TIMEOUT_MS },
  () => {
    it("carries `action` over and reads denials off the decision metadata", async () => {
      const { client, target } = await pgliteBefore("0025_");

      await client.exec(`
      insert into audit_log (installation_id, actor_type, action, target_type, metadata) values
        (4242, 'reviewer', 'auth', 'repo', '{"decision":"404"}'),
        (4242, 'reviewer', 'auth', 'api_token', '{"decision":"403","kind":"mint"}'),
        (4242, 'reviewer', 'auth', 'api_token', '{"decision":"200","kind":"mint"}'),
        (4242, 'system', 'generate', 'brief', null),
        (4242, 'app', 'delete', 'pull_request', '{"count":3}');
    `);

      await applyMigrationFile(client, target);

      const rows = await client.query<{
        operation: string;
        outcome: string;
        target_type: string;
      }>("select operation, outcome, target_type from audit_log order by id");
      expect(rows.rows).toEqual([
        { operation: "auth", outcome: "denied", target_type: "repo" },
        { operation: "auth", outcome: "denied", target_type: "api_token" },
        { operation: "auth", outcome: "ok", target_type: "api_token" },
        { operation: "generate", outcome: "ok", target_type: "brief" },
        { operation: "delete", outcome: "ok", target_type: "pull_request" },
      ]);

      // CHECK and `as const` map in lockstep, same shape as every other
      // DB-stored vocabulary.
      expect(
        (await readCheckValues(client, "audit_log_outcome_check")).toSorted(),
      ).toEqual(Object.values(AuditOutcomes).toSorted());
      expect(
        (await readCheckValues(client, "audit_log_channel_check")).toSorted(),
      ).toEqual(Object.values(AuditChannels).toSorted());
      // `classification` narrows the shared scope vocabulary; reads are never
      // audited, so `read` must NOT be accepted here.
      expect(
        (
          await readCheckValues(client, "audit_log_classification_check")
        ).toSorted(),
      ).toEqual(
        Object.values(AccessLevels)
          .filter((value) => value !== AccessLevels.READ)
          .toSorted(),
      );
    });
  },
);
