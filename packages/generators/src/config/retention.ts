import { z } from "zod/v4";
import type { Result } from "types/utils";
import { configError, type ConfigError } from "../contract/errors";
import { renderKey } from "./readRoot";

/**
 * The instance `retention` block: how long the worker's daily sweeps keep
 * audit rows and closed pull requests. An absent window keeps rows forever.
 */
export interface RetentionPolicy {
  /** Days of audit history the sweep keeps; null keeps it forever. */
  readonly auditDays: number | null;
  /** Days a closed pull request is kept; null keeps it forever. */
  readonly pullRequestDays: number | null;
}

export const DEFAULT_RETENTION_POLICY: RetentionPolicy = {
  auditDays: null,
  pullRequestDays: null,
};

/** Audit history must outlive a review session, so a shorter window is
 * refused, never widened in silence. */
const AUDIT_FLOOR_DAYS = 30;

/** A closed pull request is swept the day after its close at the shortest. */
const PULL_REQUEST_FLOOR_DAYS = 1;

function buildDaysSchema(floorDays: number): z.ZodType<number> {
  return z
    .number("must be a number of days")
    .int("must be a whole number of days")
    .min(floorDays, `must be at least ${floorDays} days`);
}

const retentionBlockSchema = z.strictObject({
  auditDays: buildDaysSchema(AUDIT_FLOOR_DAYS).optional(),
  pullRequestDays: buildDaysSchema(PULL_REQUEST_FLOOR_DAYS).optional(),
});

/** Parse a raw `retention` root value; a key never echoes a pasted credential. */
export function validateRetentionBlock(
  block: unknown,
): Result<RetentionPolicy, ConfigError> {
  const parsed = retentionBlockSchema.safeParse(block);
  if (!parsed.success) {
    return configError(
      parsed.error.issues.map((issue) => {
        if (issue.code === "unrecognized_keys") {
          return `retention: unrecognized key${issue.keys.length > 1 ? "s" : ""} ${issue.keys
            .map(renderKey)
            .join(", ")}`;
        }
        const path = issue.path.map(String).join(".");
        const where = path.length > 0 ? `${path}: ` : "";
        return `retention: ${where}${issue.message}`;
      }),
    );
  }

  return {
    ok: true,
    value: {
      auditDays: parsed.data.auditDays ?? null,
      pullRequestDays: parsed.data.pullRequestDays ?? null,
    },
  };
}
