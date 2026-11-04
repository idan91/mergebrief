// CHECK expression builders for the table files. A CHECK takes no bind
// parameters, so every value renders as an inline, quoted literal.
import { type SQL, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

function quoteLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export function isOneOf(column: AnyPgColumn, values: readonly string[]): SQL {
  const literals = values.map(quoteLiteral).join(", ");
  return sql`${column} in (${sql.raw(literals)})`;
}

export function isNullOrOneOf(
  column: AnyPgColumn,
  values: readonly string[],
): SQL {
  return sql`${column} is null or ${isOneOf(column, values)}`;
}

export function differsFrom(column: AnyPgColumn, value: string): SQL {
  const literal = quoteLiteral(value);
  return sql`${column} <> ${sql.raw(literal)}`;
}

export function isDistinctFrom(column: AnyPgColumn, value: string): SQL {
  const literal = quoteLiteral(value);
  return sql`${column} is distinct from ${sql.raw(literal)}`;
}

/** A NULL passes, as it does in every CHECK, so a nullable column stays nullable. */
export function isJsonObject(column: AnyPgColumn): SQL {
  return sql`${column} is json object`;
}

export function isJsonArray(column: AnyPgColumn): SQL {
  return sql`${column} is json array`;
}

/** The pattern's source must read the same as a POSIX regex. */
export function matchesPattern(column: AnyPgColumn, pattern: RegExp): SQL {
  const literal = quoteLiteral(pattern.source);
  return sql`${column} ~ ${sql.raw(literal)}`;
}
