// The expand-and-contract gate over `drizzle/*.sql`: a migration that drops,
// renames, retypes or tightens must open with `-- contracts <release>`,
// naming the release whose expand step it finishes. Pure additions pass.
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  collectOffenders,
  findContractStatements,
  GRANDFATHERED_MIGRATIONS,
  judgeMigration,
} from "../scripts/migration-contracts";
import { MigrationVerdicts } from "../scripts/types";

function joinSqlLines(...lines: string[]): string {
  return lines.join("\n");
}

const DROP_COLUMN = 'ALTER TABLE "brief" DROP COLUMN "legacy";';
const DROP_COLUMN_STATEMENT = 'ALTER TABLE "brief" DROP COLUMN "legacy"';
const DROP_SHAPE_STATEMENT =
  'ALTER TABLE "brief" DROP CONSTRAINT "brief_shape"';
const DROP_SHAPE = `${DROP_SHAPE_STATEMENT};--> statement-breakpoint`;
const READD_SHAPE =
  'ALTER TABLE "brief" ADD CONSTRAINT "brief_shape" CHECK ("n" IN (1, 2, 3));--> statement-breakpoint';
const MIGRATIONS_DIR = fileURLToPath(new URL("../drizzle", import.meta.url));

describe("judgeMigration", () => {
  it("fails a column drop with no contracts line", () => {
    const verdict = judgeMigration("0047_drop-legacy.sql", DROP_COLUMN);

    expect(verdict).toEqual({
      kind: MigrationVerdicts.MISSING_CONTRACTS_LINE,
      statements: [DROP_COLUMN_STATEMENT],
    });
  });

  it("passes a column drop that names the release it contracts", () => {
    const verdict = judgeMigration(
      "0047_drop-legacy.sql",
      joinSqlLines("-- contracts 1.5.0", DROP_COLUMN),
    );

    expect(verdict).toEqual({ kind: MigrationVerdicts.OK });
  });

  it("requires the contracts line to be the first line", () => {
    const verdict = judgeMigration(
      "0047_drop-legacy.sql",
      joinSqlLines("-- a comment first", "-- contracts 1.5.0", DROP_COLUMN),
    );

    expect(verdict).toMatchObject({
      kind: MigrationVerdicts.MISSING_CONTRACTS_LINE,
    });
  });

  it("requires a release number on the contracts line", () => {
    const verdict = judgeMigration(
      "0047_drop-legacy.sql",
      joinSqlLines("-- contracts next", DROP_COLUMN),
    );

    expect(verdict).toMatchObject({
      kind: MigrationVerdicts.MISSING_CONTRACTS_LINE,
    });
  });

  it("flags drops, renames, retypes and tightenings", () => {
    const cases = [
      ["DROP", "TABLE", '"legacy"'].join(" "),
      'ALTER TABLE "brief" RENAME COLUMN "a" TO "b"',
      'ALTER TABLE "brief" RENAME TO "brief2"',
      'ALTER TABLE "brief" RENAME CONSTRAINT "a" TO "b"',
      'ALTER TABLE "brief" RENAME "a" TO "b"',
      'ALTER TABLE "brief" ALTER COLUMN "n" SET DATA TYPE bigint',
      'ALTER TABLE "brief" ALTER COLUMN "n" TYPE bigint',
      'ALTER TABLE "brief" ALTER COLUMN n TYPE bigint',
      'ALTER TABLE "brief" ALTER "n" TYPE bigint',
      'ALTER TABLE "brief" ALTER COLUMN "n" SET NOT NULL',
      'ALTER TABLE "brief" DROP CONSTRAINT "brief_shape"',
      'ALTER TABLE "brief" DROP "legacy"',
      'ALTER TABLE "brief" DROP legacy',
      'ALTER TABLE "brief" DROP IF EXISTS "legacy"',
      'ALTER TABLE "brief" DROP COLUMN IF EXISTS legacy',
      'ALTER TABLE "brief" DROP expression',
      'ALTER TABLE "brief" DROP identity CASCADE',
      'DROP INDEX "brief_idx"',
      'DROP INDEX CONCURRENTLY IF EXISTS "brief_idx"',
      'DROP TRIGGER "sync_x" ON "brief"',
    ];

    for (const statement of cases) {
      expect(judgeMigration("0047_x.sql", `${statement};`)).toEqual({
        kind: MigrationVerdicts.MISSING_CONTRACTS_LINE,
        statements: [statement],
      });
    }
  });

  it("flags a retype written across several lines", () => {
    const verdict = judgeMigration(
      "0047_x.sql",
      joinSqlLines(
        'ALTER TABLE "brief"',
        '  ALTER COLUMN "n"',
        "  SET DATA TYPE bigint;",
      ),
    );

    expect(verdict).toEqual({
      kind: MigrationVerdicts.MISSING_CONTRACTS_LINE,
      statements: ['ALTER TABLE "brief" ALTER COLUMN "n" SET DATA TYPE bigint'],
    });
  });

  it("flags a NOT NULL column added without a default and a DELETE", () => {
    const cases = [
      'ALTER TABLE "brief" ADD COLUMN "owner" bigint NOT NULL;',
      'ALTER TABLE "brief" ADD COLUMN IF NOT EXISTS owner bigint NOT NULL;',
      'DELETE FROM "brief";',
      "delete from brief where id = 1;",
    ];

    for (const statement of cases) {
      expect(judgeMigration("0047_x.sql", statement).kind).toBe(
        MigrationVerdicts.MISSING_CONTRACTS_LINE,
      );
    }
  });

  it("passes a NOT NULL column added with a default", () => {
    const statement =
      'ALTER TABLE "brief" ADD COLUMN "n" integer DEFAULT 0 NOT NULL;';

    expect(judgeMigration("0047_x.sql", statement)).toEqual({
      kind: MigrationVerdicts.OK,
    });
  });

  it("passes pure additions, widenings and comments naming a drop", () => {
    const cases = [
      'CREATE TABLE "thing" ("id" bigint PRIMARY KEY);',
      'ALTER TABLE "brief" ADD COLUMN "extra" text;',
      'CREATE INDEX "brief_extra_idx" ON "brief" ("extra");',
      'ALTER TABLE "brief" ALTER COLUMN "extra" DROP NOT NULL;',
      'ALTER TABLE "brief" ALTER COLUMN "extra" DROP DEFAULT;',
      'ALTER TABLE "brief" ALTER COLUMN "extra" DROP IDENTITY IF EXISTS;',
      'ALTER TABLE "brief" ALTER COLUMN "extra" DROP EXPRESSION;',
      'ALTER TABLE "brief" ALTER extra DROP IDENTITY;',
      'ALTER TABLE "brief" ALTER COLUMN "type" SET DEFAULT 1;',
      'CREATE OR REPLACE VIEW "v" AS SELECT 1;',
      "-- a comment that names a drop in prose: DROP COLUMN later",
      'ALTER TABLE "brief" ADD COLUMN "y" text; -- DROP COLUMN "x" next release',
    ];

    for (const statement of cases) {
      expect(judgeMigration("0047_x.sql", statement)).toEqual({
        kind: MigrationVerdicts.OK,
      });
    }
  });

  it("reports every destructive statement of a file", () => {
    const verdict = judgeMigration(
      "0047_x.sql",
      joinSqlLines(
        'ALTER TABLE "a" DROP COLUMN "x";--> statement-breakpoint',
        'ALTER TABLE "b" ADD COLUMN "y" text;--> statement-breakpoint',
        'ALTER TABLE "c" RENAME TO "d";',
      ),
    );

    expect(verdict).toEqual({
      kind: MigrationVerdicts.MISSING_CONTRACTS_LINE,
      statements: [
        'ALTER TABLE "a" DROP COLUMN "x"',
        'ALTER TABLE "c" RENAME TO "d"',
      ],
    });
  });

  it("passes a widens-marked constraint drop re-added as a CHECK", () => {
    const verdict = judgeMigration(
      "0047_x.sql",
      joinSqlLines("-- widens brief_shape", DROP_SHAPE, READD_SHAPE),
    );

    expect(verdict).toEqual({ kind: MigrationVerdicts.OK });
  });

  it("fails a widens marker whose file never re-adds the constraint", () => {
    const verdict = judgeMigration(
      "0047_x.sql",
      joinSqlLines("-- widens brief_shape", DROP_SHAPE),
    );

    expect(verdict).toEqual({
      kind: MigrationVerdicts.MISSING_CONTRACTS_LINE,
      statements: [DROP_SHAPE_STATEMENT],
    });
  });

  it("fails a widens marker that names a different constraint", () => {
    const verdict = judgeMigration(
      "0047_x.sql",
      joinSqlLines("-- widens brief_other", DROP_SHAPE, READD_SHAPE),
    );

    expect(verdict).toEqual({
      kind: MigrationVerdicts.MISSING_CONTRACTS_LINE,
      statements: [DROP_SHAPE_STATEMENT],
    });
  });

  it("still asks a contracts line of the other drops in a widening file", () => {
    const verdict = judgeMigration(
      "0047_x.sql",
      joinSqlLines(
        "-- widens brief_shape",
        DROP_SHAPE,
        READD_SHAPE,
        DROP_COLUMN,
      ),
    );

    expect(verdict).toEqual({
      kind: MigrationVerdicts.MISSING_CONTRACTS_LINE,
      statements: [DROP_COLUMN_STATEMENT],
    });
  });

  it("grandfathers the migrations that predate the rule by name", () => {
    expect(GRANDFATHERED_MIGRATIONS).toContain(
      "0042_drop-installation-columns",
    );

    const verdict = judgeMigration(
      "0042_drop-installation-columns.sql",
      'ALTER TABLE "api_token" DROP COLUMN "installation_id";',
    );

    expect(verdict).toEqual({ kind: MigrationVerdicts.GRANDFATHERED });
  });
});

describe("collectOffenders", () => {
  it("names the offending files in name order and skips the rest", () => {
    const dir = mkdtempSync(join(tmpdir(), "mb-contracts-"));
    writeFileSync(join(dir, "0002_b.sql"), DROP_COLUMN);
    writeFileSync(join(dir, "0001_a.sql"), 'DROP TABLE "old";');
    writeFileSync(
      join(dir, "0003_c.sql"),
      joinSqlLines("-- contracts 1.5.0", DROP_COLUMN),
    );
    writeFileSync(
      join(dir, "0004_d.sql"),
      'ALTER TABLE "t" ADD COLUMN "c" int;',
    );
    writeFileSync(join(dir, "notes.json"), '{"DROP TABLE": true}');

    expect(collectOffenders(dir)).toEqual([
      { file: "0001_a.sql", statements: ['DROP TABLE "old"'] },
      { file: "0002_b.sql", statements: [DROP_COLUMN_STATEMENT] },
    ]);
  });

  it("holds the grandfather list exact against the checked-in files", () => {
    const tripping = readdirSync(MIGRATIONS_DIR)
      .filter((name) => name.endsWith(".sql"))
      .filter((name) => {
        const body = readFileSync(join(MIGRATIONS_DIR, name), "utf8");
        const unmarked = !body.startsWith("-- contracts ");
        return unmarked && findContractStatements(body).length > 0;
      })
      .map((name) => name.replace(/\.sql$/, ""))
      .toSorted();

    expect(tripping).toEqual([...GRANDFATHERED_MIGRATIONS].toSorted());
    expect(collectOffenders(MIGRATIONS_DIR)).toEqual([]);
  });
});
