import { z } from "zod/v4";
import type { Result } from "types/utils";
import { configError, type ConfigError } from "../contract/errors";
import { renderKey } from "./readRoot";

/**
 * The instance spend policy: the operator's daily generation cap, parsed out
 * of `mergebrief.config.yaml`'s `spend` block by the same loaders that own
 * `generator` and `drafts`. INSTANCE config only; no key here has a
 * `.mergebrief/` repo-side counterpart and a repo file can never widen it.
 */

/** Unset = uncapped, the zero-config default. */
export interface SpendPolicy {
  /** Generations per UTC calendar day across every repo; null = uncapped. */
  readonly maxGenerationsPerDay: number | null;
}

export const DEFAULT_SPEND_POLICY: SpendPolicy = {
  maxGenerationsPerDay: null,
};

const capSchema = z
  .number()
  .int("must be a whole number")
  .positive("must be greater than 0");

const spendBlockSchema = z.strictObject({
  maxGenerationsPerDay: capSchema.optional(),
});

/**
 * Parse a raw `spend` root value. Same message posture as the sibling
 * blocks: issues name fields and reasons, and any raw key text goes through
 * `renderKey`; a credential pasted as a stray key must not echo.
 */
export function validateSpendBlock(
  block: unknown,
): Result<SpendPolicy, ConfigError> {
  const parsed = spendBlockSchema.safeParse(block);
  if (!parsed.success) {
    return configError(
      parsed.error.issues.map((issue) => {
        if (issue.code === "unrecognized_keys") {
          return `spend: unrecognized key${issue.keys.length > 1 ? "s" : ""} ${issue.keys
            .map(renderKey)
            .join(", ")}`;
        }
        const path = issue.path
          .map((segment) =>
            typeof segment === "string" ? renderKey(segment) : String(segment),
          )
          .join(".");
        return `spend: ${path.length > 0 ? `${path}: ` : ""}${issue.message}`;
      }),
    );
  }

  return {
    ok: true,
    value: { maxGenerationsPerDay: parsed.data.maxGenerationsPerDay ?? null },
  };
}
