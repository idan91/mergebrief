// The expand-and-contract gate's judgment: a migration that drops, renames,
// retypes or tightens breaks the release before it, so it must open with
// `-- contracts <release>` naming the release whose expand step it finishes.
// Grep-level on purpose; the rule itself lives in AGENTS.md.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  MigrationVerdicts,
  type MigrationJudgment,
  type MigrationOffender,
} from "./types";

/**
 * Migrations that dropped, renamed, retyped or tightened before the rule
 * existed. The rule applies from 0046 on; these are never retro-fixed, and
 * the test suite holds the list exact against the checked-in files.
 */
export const GRANDFATHERED_MIGRATIONS: readonly string[] = [
  "0003_brief2-schema-additions",
  "0007_audit-action-submit",
  "0010_audit-action-mark-ready",
  "0013_github-grant",
  "0014_audit-action-resolve-thread",
  "0015_generation-status-capped",
  "0017_generation-failure-codes",
  "0018_auth-session-rename",
  "0020_disposition-drop-legacy-anchors",
  "0025_audit-operation-columns",
  "0026_audit-drop-action",
  "0032_draft-comment-start-side",
  "0033_url-brief-tenancy",
  "0034_draft-comment-kind",
  "0036_generation-pending",
  "0039_source-values",
  "0042_drop-installation-columns",
];

/** `-- contracts 1.5.0`, and nothing else, on the first line. */
const CONTRACTS_LINE = /^-- contracts \d+\.\d+\.\d+\s*$/;

const IDENTIFIER = String.raw`("[^"]+"|\w+)`;

/** The `ALTER [COLUMN] x DROP ...` position, where IDENTITY and EXPRESSION are clauses, not column names. */
const ALTER_COLUMN_DROP = String.raw`\bALTER\s+(COLUMN\s+)?${IDENTIFIER}\s+DROP\s+`;

/**
 * What release N-1 cannot survive: a dropped table, column, constraint,
 * index or trigger, a rename, a column type change, a NOT NULL tightening.
 * A bare `DROP name` is a column drop with the keyword left out, so it
 * counts; the four `ALTER COLUMN ... DROP` clauses (NOT NULL, DEFAULT,
 * IDENTITY, EXPRESSION) only widen, so they pass.
 */
const DESTRUCTIVE_STATEMENT = new RegExp(
  [
    String.raw`\bDROP\s+(TABLE|COLUMN|CONSTRAINT|INDEX|SEQUENCE|TYPE|VIEW|TRIGGER|SCHEMA|FUNCTION)\b`,
    String.raw`\bDROP\s+(IF\s+EXISTS\s+)?(?!NOT\b|DEFAULT\b)(?!(?<=${ALTER_COLUMN_DROP})(IDENTITY|EXPRESSION)\b)${IDENTIFIER}`,
    String.raw`\bRENAME\s+(TO|COLUMN|CONSTRAINT)\b`,
    String.raw`\bRENAME\s+${IDENTIFIER}\s+TO\b`,
    String.raw`\bALTER\s+(COLUMN\s+)?${IDENTIFIER}\s+(SET\s+DATA\s+)?TYPE\b`,
    String.raw`\bALTER\s+(COLUMN\s+)?${IDENTIFIER}\s+SET\s+NOT\s+NULL\b`,
  ].join("|"),
  "i",
);

const STATEMENT_BREAKPOINT = "--> statement-breakpoint";

function stripComment(line: string): string {
  const at = line.indexOf("--");
  return at === -1 ? line : line.slice(0, at);
}

/** Statements with comments gone and whitespace collapsed, in file order. */
export function splitStatements(body: string): string[] {
  const text = body
    .replaceAll(STATEMENT_BREAKPOINT, ";")
    .split("\n")
    .map(stripComment)
    .join(" ");
  return text
    .split(";")
    .map((statement) => statement.replace(/\s+/g, " ").trim())
    .filter((statement) => statement.length > 0);
}

export function findDestructiveStatements(body: string): string[] {
  return splitStatements(body).filter((statement) =>
    DESTRUCTIVE_STATEMENT.test(statement),
  );
}

export function judgeMigration(
  fileName: string,
  body: string,
): MigrationJudgment {
  const tag = fileName.replace(/\.sql$/, "");
  if (GRANDFATHERED_MIGRATIONS.includes(tag)) {
    return { kind: MigrationVerdicts.GRANDFATHERED };
  }

  const statements = findDestructiveStatements(body);
  if (statements.length === 0) {
    return { kind: MigrationVerdicts.OK };
  }

  const firstLine = body.split("\n")[0] ?? "";
  if (CONTRACTS_LINE.test(firstLine)) {
    return { kind: MigrationVerdicts.OK };
  }
  return { kind: MigrationVerdicts.MISSING_CONTRACTS_LINE, statements };
}

/** The `.sql` files under `dir`, in name order, that the gate refuses. */
export function collectOffenders(dir: string): MigrationOffender[] {
  const offenders: MigrationOffender[] = [];
  const files = readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .toSorted();

  for (const file of files) {
    const body = readFileSync(join(dir, file), "utf8");
    const verdict = judgeMigration(file, body);
    if (verdict.kind === MigrationVerdicts.MISSING_CONTRACTS_LINE) {
      offenders.push({ file, statements: verdict.statements });
    }
  }
  return offenders;
}
