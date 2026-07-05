// Branded-id construction at the webhook boundary (BRIEF-2 stage 2). GitHub
// sends numeric ids as JSON numbers; the persistence layer models the same
// ids as branded `bigint`s (ADR 0018 D1). These are LOCAL runtime guards that
// mirror `packages/persistence/src/types.ts` — the brand tag strings are
// identical, so a value this guard narrows to `InstallationId` unifies with
// persistence's `InstallationId` at compile time while keeping ZERO runtime
// coupling to the DB layer (same reasoning AGENTS.md gives for `Result`/
// `ValueOf`). The branded types themselves are a type-only import.
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

/** Zod schema producing a branded `InstallationId` from a JSON number. */
export const installationIdSchema = brandedIdSchema(
  isInstallationId,
  "installation id",
);
/** Zod schema producing a branded `RepoId` from a JSON number. */
export const repoIdSchema = brandedIdSchema(isRepoId, "repository id");
/** Zod schema producing a branded `ReviewerId` from a JSON number. */
export const reviewerIdSchema = brandedIdSchema(isReviewerId, "reviewer id");

/**
 * A positive `bigint` from a JSON number, UNbranded — used for actor ids
 * (`sender.id`) that the audit ledger stores numerically but that have no
 * dedicated branded family in `persistence`.
 */
export const positiveBigIntSchema = z
  .number({ invalid_type_error: "id must be a number" })
  .int("id must be an integer")
  .transform((value, ctx) => {
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
