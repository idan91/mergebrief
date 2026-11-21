import { z } from "zod/v4";
import type { Result } from "types/utils";
import { configError, type ConfigError } from "../contract/errors";
import { renderKey } from "./render-key";

/**
 * The instance spend policy: the operator's daily generation cap, parsed out
 * of `mergebrief.config.yaml`'s `spend` block by the same loaders that own
 * `generator` and `drafts`. INSTANCE config only; no key here has a
 * `.mergebrief/` repo-side counterpart and a repo file can never widen it.
 */

/** Omitted = 300 a day; only `maxGenerationsPerDay: unlimited` lifts the cap. */
export interface SpendPolicy {
  /** Generations per UTC calendar day across every repo; null = uncapped. */
  readonly maxGenerationsPerDay: number | null;
}

const DEFAULT_GENERATIONS_PER_DAY = 300;
const UNLIMITED_CAP = "unlimited";
const capIssue = `must be a positive whole number or "${UNLIMITED_CAP}"`;

export const DEFAULT_SPEND_POLICY: SpendPolicy = {
  maxGenerationsPerDay: DEFAULT_GENERATIONS_PER_DAY,
};

const capSchema = z.union(
  [
    z.number().int(capIssue).positive(capIssue),
    z.literal(UNLIMITED_CAP).transform(() => null),
  ],
  { error: capIssue },
);

const spendBlockSchema = z.strictObject({
  maxGenerationsPerDay: capSchema.default(DEFAULT_GENERATIONS_PER_DAY),
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

  return { ok: true, value: parsed.data };
}
