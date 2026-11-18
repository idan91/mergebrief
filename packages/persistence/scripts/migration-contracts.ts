// The expand-and-contract gate's judgment: a migration that drops, renames,
// retypes or tightens breaks the release before it, so it must open with
// `-- contracts <release>` naming the release whose expand step it finishes.
// A constraint drop marked `-- widens <name>` and re-added as a CHECK of that
// name is exempt. Grep-level on purpose; the rule itself lives in AGENTS.md.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  MigrationVerdicts,
  type MigrationJudgment,
  type MigrationOffender,
} from "./types";

/** `-- contracts 1.5.0`, and nothing else, on the first line. */
const CONTRACTS_LINE = /^-- contracts \d+\.\d+\.\d+\s*$/;

const IDENTIFIER = String.raw`("[^"]+"|\w+)`;

/** The `ALTER [COLUMN] x DROP ...` position, where IDENTITY and EXPRESSION are clauses, not column names. */
const ALTER_COLUMN_DROP = String.raw`\bALTER\s+(COLUMN\s+)?${IDENTIFIER}\s+DROP\s+`;

/**
 * What release N-1 cannot survive: a dropped table, column, constraint,
 * index or trigger, a rename, a column type change, a NOT NULL tightening,
 * a NOT NULL column added with no default (N-1's inserts omit it), and a
 * DELETE (rows N-1 still reads go away).
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
    String.raw`\bADD\s+COLUMN\s+(IF\s+NOT\s+EXISTS\s+)?${IDENTIFIER}(?!.*\bDEFAULT\b).*\bNOT\s+NULL\b`,
    String.raw`\bDELETE\s+FROM\b`,
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

/** `-- widens <constraint>`, on a line of its own anywhere in the file. */
const WIDENS_LINE = /^-- widens (\w+)\s*$/;

/** A statement that does nothing but drop one named constraint. */
const DROP_CONSTRAINT_ONLY = new RegExp(
  String.raw`^ALTER\s+TABLE\s+(ONLY\s+)?${IDENTIFIER}\s+DROP\s+CONSTRAINT\s+(IF\s+EXISTS\s+)?${IDENTIFIER}$`,
  "i",
);

/** `ADD CONSTRAINT <name> CHECK`, the re-add a widening needs. */
const ADD_CHECK_CONSTRAINT = new RegExp(
  String.raw`\bADD\s+CONSTRAINT\s+${IDENTIFIER}\s+CHECK\b`,
  "i",
);

function unquote(identifier: string): string {
  return identifier.replace(/^"(.*)"$/, "$1");
}

function readWidenedNames(body: string): Set<string> {
  const names = new Set<string>();
  for (const line of body.split("\n")) {
    const marked = WIDENS_LINE.exec(line.trim());
    if (marked?.[1] !== undefined) {
      names.add(marked[1]);
    }
  }
  return names;
}

function readReaddedCheckNames(statements: readonly string[]): Set<string> {
  const names = new Set<string>();
  for (const statement of statements) {
    const added = ADD_CHECK_CONSTRAINT.exec(statement);
    if (added?.[1] !== undefined) {
      names.add(unquote(added[1]));
    }
  }
  return names;
}

/**
 * The destructive statements the contracts line must cover: every one but a
 * constraint drop the file marks `-- widens <name>` and re-adds as a CHECK
 * under the same name. The gate trusts the marker; review judges the widening.
 */
export function findContractStatements(body: string): string[] {
  const widened = readWidenedNames(body);
  const readded = readReaddedCheckNames(splitStatements(body));

  return findDestructiveStatements(body).filter((statement) => {
    const dropped = DROP_CONSTRAINT_ONLY.exec(statement)?.[4];
    if (dropped === undefined) {
      return true;
    }
    const name = unquote(dropped);
    return !(widened.has(name) && readded.has(name));
  });
}

export function judgeMigration(body: string): MigrationJudgment {
  const statements = findContractStatements(body);
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
    const verdict = judgeMigration(body);
    if (verdict.kind === MigrationVerdicts.MISSING_CONTRACTS_LINE) {
      offenders.push({ file, statements: verdict.statements });
    }
  }
  return offenders;
}
