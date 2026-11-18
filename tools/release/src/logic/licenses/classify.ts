import type { Result } from "types/utils";

import { ALLOWED_LICENSES, LICENSE_EXCEPTIONS } from "./consts";
import type {
  ExceptedPackage,
  ExpressionParse,
  LicensedPackage,
  LicenseVerdict,
} from "./types";

const SPDX_ID = /^[A-Za-z0-9.-]+$/;

const OPERATORS = new Set(["AND", "OR", "WITH", "(", ")"]);

interface TokenCursor {
  readonly tokens: readonly string[];
  position: number;
}

function tokenizeExpression(expression: string): string[] {
  const spaced = expression.replaceAll("(", " ( ").replaceAll(")", " ) ");
  return spaced.split(/\s+/).filter((token) => token.length > 0);
}

function failAt(position: number): ExpressionParse {
  return { ok: false, error: { position } };
}

function parseOr(cursor: TokenCursor): ExpressionParse {
  const first = parseAnd(cursor);
  if (!first.ok) {
    return first;
  }

  let allowed = first.value;
  while (cursor.tokens[cursor.position] === "OR") {
    cursor.position += 1;
    const branch = parseAnd(cursor);
    if (!branch.ok) {
      return branch;
    }
    allowed = allowed || branch.value;
  }
  return { ok: true, value: allowed };
}

function parseAnd(cursor: TokenCursor): ExpressionParse {
  const first = parseTerm(cursor);
  if (!first.ok) {
    return first;
  }

  let allowed = first.value;
  while (cursor.tokens[cursor.position] === "AND") {
    cursor.position += 1;
    const branch = parseTerm(cursor);
    if (!branch.ok) {
      return branch;
    }
    allowed = allowed && branch.value;
  }
  return { ok: true, value: allowed };
}

function parseTerm(cursor: TokenCursor): ExpressionParse {
  const start = cursor.position;
  const token = cursor.tokens[start];
  cursor.position += 1;
  if (token === "(") {
    const inner = parseOr(cursor);
    if (!inner.ok) {
      return inner;
    }
    if (cursor.tokens[cursor.position] !== ")") {
      return failAt(cursor.position);
    }
    cursor.position += 1;
    return inner;
  }

  const isIdentifier =
    token !== undefined && !OPERATORS.has(token) && SPDX_ID.test(token);
  if (!isIdentifier) {
    return failAt(start);
  }
  return { ok: true, value: ALLOWED_LICENSES.has(token) };
}

/** SPDX `OR` passes when any branch passes, `AND` only when every branch does; anything unresolved fails. */
export function isLicenseAllowed(expression: string): boolean {
  const cursor: TokenCursor = {
    tokens: tokenizeExpression(expression),
    position: 0,
  };
  const parsed = parseOr(cursor);
  const consumedAll = cursor.position === cursor.tokens.length;
  const expressionAllowed = parsed.ok && parsed.value && consumedAll;
  return expressionAllowed;
}

const NAME_PREFIX_MARK = "*";

function matchesExceptionName(pattern: string, name: string): boolean {
  if (!pattern.endsWith(NAME_PREFIX_MARK)) {
    return pattern === name;
  }
  return name.startsWith(pattern.slice(0, -NAME_PREFIX_MARK.length));
}

function findExceptedPackage(
  pkg: LicensedPackage,
): ExceptedPackage | undefined {
  const exception = LICENSE_EXCEPTIONS.find((candidate) => {
    const matchesPackage =
      matchesExceptionName(candidate.name, pkg.name) &&
      candidate.license === pkg.license;
    return matchesPackage;
  });
  if (exception === undefined) {
    return undefined;
  }
  return { ...pkg, reason: exception.reason };
}

/** Passes when every package's license is allowed or excepted by name; else the failing packages. */
export function classifyLicenses(
  packages: readonly LicensedPackage[],
): Result<LicenseVerdict, readonly LicensedPackage[]> {
  const failing: LicensedPackage[] = [];
  const excepted: ExceptedPackage[] = [];

  for (const pkg of packages) {
    if (isLicenseAllowed(pkg.license)) {
      continue;
    }
    const exceptedPackage = findExceptedPackage(pkg);
    if (exceptedPackage === undefined) {
      failing.push(pkg);
    } else {
      excepted.push(exceptedPackage);
    }
  }

  if (failing.length > 0) {
    return { ok: false, error: failing };
  }
  return { ok: true, value: { checked: packages.length, excepted } };
}
