import { z } from "zod/v4";
import type { Result } from "types/utils";
import { configError, type ConfigError } from "../contract/errors";
import { renderKey } from "./readRoot";

/**
 * The instance `allowed` block: who besides an Operator may start a paid run
 * and sign in. Ids, never logins: GitHub frees a renamed login, and whoever
 * claims it next must not inherit the access.
 */

export interface AllowedAccess {
  /** GitHub user ids. */
  readonly users: ReadonlySet<bigint>;
  /** GitHub org or personal account ids holding an installation of the App. */
  readonly accounts: ReadonlySet<bigint>;
}

const MAX_ALLOWED_IDS = 1000;

const allowedIdsSchema = z
  .array(
    z
      .number("must be a GitHub id, not a name")
      .int("must be a whole number")
      .positive("must be greater than 0"),
  )
  .max(MAX_ALLOWED_IDS);

const allowedBlockSchema = z
  .strictObject({
    users: allowedIdsSchema.optional(),
    accounts: allowedIdsSchema.optional(),
  })
  .refine(
    (block) => block.users !== undefined || block.accounts !== undefined,
    {
      message: "must name users or accounts",
    },
  );

function buildIdSet(ids: readonly number[] | undefined): ReadonlySet<bigint> {
  return new Set((ids ?? []).map((id) => BigInt(id)));
}

export function validateAllowedBlock(
  block: unknown,
): Result<AllowedAccess, ConfigError> {
  const parsed = allowedBlockSchema.safeParse(block);
  if (!parsed.success) {
    return configError(
      parsed.error.issues.map((issue) => {
        // Zod's unrecognized_keys message interpolates the raw key text, and a
        // pasted credential used as a stray key must not echo.
        if (issue.code === "unrecognized_keys") {
          return `allowed: unrecognized keys ${issue.keys.map(renderKey).join(", ")}`;
        }
        const path = issue.path.map(String).join(".");
        const where = path.length > 0 ? `${path}: ` : "";
        return `allowed: ${where}${issue.message}`;
      }),
    );
  }

  return {
    ok: true,
    value: {
      users: buildIdSet(parsed.data.users),
      accounts: buildIdSet(parsed.data.accounts),
    },
  };
}
