import type { Result } from "types/utils";

const STATEMENT_BREAKPOINT = "--> statement-breakpoint";

/** A dollar-quoted body means a function or DO block, and no such object
 * belongs in a baseline built from a migrated schema. */
const DOLLAR_QUOTE = "$$";

/**
 * One statement per terminating `;` at line end. pg_dump ends every
 * statement that way and never ends a continuation line with one, so a
 * semicolon inside a string literal mid-line stays with its statement.
 */
export function splitDumpStatements(
  normalized: string,
): Result<string[], string> {
  if (normalized.includes(DOLLAR_QUOTE)) {
    return {
      ok: false,
      error:
        "dump holds a dollar-quoted body; a function or DO block cannot ride in the baseline",
    };
  }

  const statements: string[] = [];
  let pending: string[] = [];
  for (const line of normalized.split("\n")) {
    pending.push(line);
    if (line.endsWith(";")) {
      statements.push(pending.join("\n"));
      pending = [];
    }
  }

  const leftover = pending.join("\n").trim();
  if (leftover.length > 0) {
    return {
      ok: false,
      error: `dump ends with an unterminated statement: ${leftover}`,
    };
  }
  return { ok: true, value: statements };
}

/** The migration file body: statements joined by drizzle's breakpoint marker,
 * no trailing newline, as drizzle-kit itself writes a migration. */
export function buildBaselineSql(statements: readonly string[]): string {
  return statements.join(`\n${STATEMENT_BREAKPOINT}\n`);
}
