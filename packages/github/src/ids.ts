// Branded-id construction at the webhook boundary. GitHub sends numeric ids as
// JSON numbers; persistence models them as branded `bigint`s. These are LOCAL
// guards mirroring persistence's — the brand tag strings are identical, so the
// narrowed types unify at compile time with ZERO runtime coupling to the DB
// layer. The branded types themselves are a type-only import.
import { z } from "zod";
import type { InstallationId, RepoId, ReviewerId } from "persistence";

// ---------------------------------------------------------------------------
// Runtime guards — GitHub numeric ids and Postgres identity values are always
// positive, so a positive `bigint` is the sanctioned brand (never `as`).
// ---------------------------------------------------------------------------

function isPositiveBigInt(value: bigint): boolean {
  return value > 0n;
}

export function isInstallationId(value: bigint): value is InstallationId {
  return isPositiveBigInt(value);
}

export function isRepoId(value: bigint): value is RepoId {
  return isPositiveBigInt(value);
}

export function isReviewerId(value: bigint): value is ReviewerId {
  return isPositiveBigInt(value);
}

// ---------------------------------------------------------------------------
// Zod boundary schemas — parse a JSON number, convert to `bigint`, then brand
// via the guard. A non-positive id (never sent by GitHub) fails the parse
// rather than being force-cast.
// ---------------------------------------------------------------------------

function brandedIdSchema<B extends bigint>(
  guard: (value: bigint) => value is B,
  label: string,
) {
  return z
    .number({ invalid_type_error: `${label} must be a number` })
    .int(`${label} must be an integer`)
    .transform((value, ctx) => {
      // `JSON.parse` rounds integers above 2^53 to the nearest double BEFORE we
      // see them, so a raw number that large is already lossy — reject it rather
      // than brand a silently-rounded id. (`.int()` does not guard precision.)
      if (!Number.isSafeInteger(value)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${label} exceeds the safe integer range`,
        });
        return z.NEVER;
      }
      const asBigInt = BigInt(value);
      if (!guard(asBigInt)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${label} must be a positive integer id`,
        });
        return z.NEVER;
      }
      return asBigInt;
    });
}

export const installationIdSchema = brandedIdSchema(
  isInstallationId,
  "installation id",
);
export const repoIdSchema = brandedIdSchema(isRepoId, "repository id");
export const reviewerIdSchema = brandedIdSchema(isReviewerId, "reviewer id");

/**
 * A positive `bigint` from a JSON number, UNbranded — for actor ids that have
 * no dedicated branded family in `persistence`.
 */
export const positiveBigIntSchema = z
  .number({ invalid_type_error: "id must be a number" })
  .int("id must be an integer")
  .transform((value, ctx) => {
    // See `brandedIdSchema`: an integer past 2^53 is already lossy post-parse.
    if (!Number.isSafeInteger(value)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "id exceeds the safe integer range",
      });
      return z.NEVER;
    }
    const asBigInt = BigInt(value);
    if (asBigInt <= 0n) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "id must be a positive integer",
      });
      return z.NEVER;
    }
    return asBigInt;
  });
