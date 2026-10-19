import { z } from "zod/v4";
import type { Result } from "types/utils";
import { configError, type ConfigError } from "../contract/errors";

/**
 * The instance `operators` block: the GitHub user ids of the people who run
 * the Instance and may read its spend. An id, never a login: GitHub frees a
 * renamed login, and whoever claims it next must not inherit the role.
 */

/** The GitHub user ids the Instance names as Operators; empty means nobody. */
export type OperatorIds = ReadonlySet<bigint>;

export const NO_OPERATORS: OperatorIds = new Set();

const MAX_OPERATORS = 100;

const operatorsBlockSchema = z
  .array(
    z
      .number("must be a GitHub user id, not a login")
      .int("must be a whole number")
      .positive("must be greater than 0"),
  )
  .max(MAX_OPERATORS);

export function validateOperatorsBlock(
  block: unknown,
): Result<OperatorIds, ConfigError> {
  const parsed = operatorsBlockSchema.safeParse(block);
  if (!parsed.success) {
    return configError(
      parsed.error.issues.map((issue) => {
        const path = issue.path.map(String).join(".");
        const where = path.length > 0 ? `${path}: ` : "";
        const line = `operators: ${where}${issue.message}`;
        return line;
      }),
    );
  }

  const operatorIds: OperatorIds = new Set(parsed.data.map((id) => BigInt(id)));
  return { ok: true, value: operatorIds };
}
