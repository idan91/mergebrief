// Migration 0025 backfill test — same posture as migration-0024.test.ts: the
// transform must run against PRE-migration rows, which the shared harness (all
// migrations upfront, empty DB) cannot express. Applies 0000-0024 raw, seeds
// rows that only carry `action`, applies 0025, and asserts the history reads
// the same afterwards — a denial must not backfill as a success.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { AuditChannel, AuditOutcome, WriteClassification } from "../src/types";

const MIGRATIONS_DIR = fileURLToPath(new URL("../drizzle", import.meta.url));

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .toSorted((a, b) => a.localeCompare(b));
}

async function applyFile(client: PGlite, name: string): Promise<void> {
  await client.exec(readFileSync(join(MIGRATIONS_DIR, name), "utf8"));
}

/** The literals a CHECK constraint accepts. */
async function checkValues(
  client: PGlite,
  constraintName: string,
): Promise<string[]> {
  const result = await client.query<{ def: string }>(
    "select pg_get_constraintdef(oid) as def from pg_constraint where conname = $1",
    [constraintName],
  );
  const def = result.rows[0]?.def;
  if (def === undefined) {
    throw new Error(`constraint ${constraintName} not found`);
  }
  return [...def.matchAll(/'([^']*)'/g)].map((match) => match[1] ?? "");
}

describe("migration 0025 — audit_log operation/outcome", () => {
  it("carries `action` over and reads denials off the decision metadata", async () => {
    const client = new PGlite();
    const files = migrationFiles();
    const target = files.find((name) => name.startsWith("0025_"));
    if (target === undefined) throw new Error("0025 migration file not found");
    for (const name of files) {
      if (name === target) break;
      await applyFile(client, name);
    }

    await client.exec(`
      insert into audit_log (installation_id, actor_type, action, target_type, metadata) values
        (4242, 'reviewer', 'auth', 'repo', '{"decision":"404"}'),
        (4242, 'reviewer', 'auth', 'api_token', '{"decision":"403","kind":"mint"}'),
        (4242, 'reviewer', 'auth', 'api_token', '{"decision":"200","kind":"mint"}'),
        (4242, 'system', 'generate', 'brief', null),
        (4242, 'app', 'delete', 'pull_request', '{"count":3}');
    `);

    await applyFile(client, target);

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

    // Collection of the caller's address must stay a config change: every
    // backfilled row is honestly empty rather than absent.
    const ips = await client.query<{ n: number }>(
      "select count(*)::int as n from audit_log where caller_ip is not null",
    );
    expect(ips.rows[0]?.n).toBe(0);

    // CHECK and `as const` map in lockstep, same shape as every other
    // DB-stored vocabulary.
    expect(
      (await checkValues(client, "audit_log_outcome_check")).toSorted(),
    ).toEqual(Object.values(AuditOutcome).toSorted());
    expect(
      (await checkValues(client, "audit_log_channel_check")).toSorted(),
    ).toEqual(Object.values(AuditChannel).toSorted());
    // `classification` narrows the shared scope vocabulary — reads are never
    // audited, so `read` must NOT be accepted here.
    expect(
      (await checkValues(client, "audit_log_classification_check")).toSorted(),
    ).toEqual(
      Object.values(WriteClassification)
        .filter((value) => value !== WriteClassification.READ)
        .toSorted(),
    );
  });
});
