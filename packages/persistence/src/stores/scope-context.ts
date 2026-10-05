// The scope CONTEXT boundary: the shapes the web (authz middleware) and the
// worker (job payload) validate untrusted input into, and the Zod schemas
// that do the validating. Exactly one world per context: an input naming
// both, or neither, is rejected here rather than deeper in.
//
// The query side of scoping lives in `scope.ts`: this module answers "is this
// a valid identity", that one answers "which rows does it see".
import { z } from "zod";
import {
  isInstallationId,
  isReviewerId,
  type InstallationId,
  type ReviewerId,
} from "../types";
import type { Result } from "types/utils";

/** Bound App-installation tenant identity. */
export interface TenantContext {
  readonly installationId: InstallationId;
}

/** Bound url-box owner identity: the viewer's GitHub numeric user id. */
export interface OwnerContext {
  readonly ownerUserId: ReviewerId;
}

/** What every ctx-bound factory accepts: exactly one world. */
export type ScopeContext = TenantContext | OwnerContext;

export function isOwnerContext(ctx: ScopeContext): ctx is OwnerContext {
  return "ownerUserId" in ctx;
}

/** Coerce a JSON-ish scalar to a bigint; `undefined` when it isn't integral. */
function coerceBigInt(value: unknown): bigint | undefined {
  if (typeof value === "bigint") {
    return value;
  }
  if (typeof value === "number" && Number.isSafeInteger(value)) {
    return BigInt(value);
  }
  if (typeof value === "string" && /^-?\d+$/.test(value)) {
    return BigInt(value);
  }
  return undefined;
}

function brandedIdSchema<T extends bigint>(
  guard: (value: bigint) => value is T,
  label: string,
): z.ZodType<T, z.ZodTypeDef, unknown> {
  return z.unknown().transform((value, ctx): T => {
    const big = coerceBigInt(value);
    if (big === undefined || !guard(big)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${label} must be a positive integer`,
      });
      return z.NEVER;
    }
    return big;
  });
}

/** Zod schema for a branded `InstallationId` (bigint isn't JSON-native). */
const installationIdSchema = brandedIdSchema(
  isInstallationId,
  "installationId",
);

const ownerUserIdSchema = brandedIdSchema(isReviewerId, "ownerUserId");

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Normalize snake_case (worker payload) / camelCase (web) into one shape. */
function normalizeContext(raw: unknown): unknown {
  if (!isRecord(raw)) {
    return raw;
  }
  const installationId = raw["installationId"] ?? raw["installation_id"];
  const ownerUserId = raw["ownerUserId"] ?? raw["owner_user_id"];
  const normalized: Record<string, unknown> = {};
  if (installationId !== undefined && installationId !== null) {
    normalized["installationId"] = installationId;
  }
  if (ownerUserId !== undefined && ownerUserId !== null) {
    normalized["ownerUserId"] = ownerUserId;
  }
  return normalized;
}

/**
 * Validates untrusted input (job payload / request context) into a
 * `TenantContext`. Accepts `installationId` or `installation_id`, as a bigint,
 * an integer number, or a numeric string.
 */
export const TenantContextSchema = z.preprocess(
  normalizeContext,
  z.object({ installationId: installationIdSchema }),
);

/**
 * Validates untrusted input into EXACTLY ONE world: an input naming both
 * scopes (or neither) is rejected; a caller must never leave the world
 * ambiguous.
 */
export const ScopeContextSchema = z.preprocess(
  normalizeContext,
  z.union([
    z.object({ installationId: installationIdSchema }).strict(),
    z.object({ ownerUserId: ownerUserIdSchema }).strict(),
  ]),
);

/** Parse into a `TenantContext`, throwing `ZodError` on invalid input. */
export function parseTenantContext(input: unknown): TenantContext {
  return TenantContextSchema.parse(input);
}

/** Non-throwing parse for callers that prefer a Result at their boundary. */
export function safeParseTenantContext(
  input: unknown,
): Result<TenantContext, string> {
  const parsed = TenantContextSchema.safeParse(input);
  if (parsed.success) {
    return { ok: true, value: parsed.data };
  }
  return { ok: false, error: parsed.error.message };
}

/** Parse into a `ScopeContext`, throwing `ZodError` on invalid input. */
export function parseScopeContext(input: unknown): ScopeContext {
  return ScopeContextSchema.parse(input);
}

/** Non-throwing parse for callers that prefer a Result at their boundary. */
export function safeParseScopeContext(
  input: unknown,
): Result<ScopeContext, string> {
  const parsed = ScopeContextSchema.safeParse(input);
  if (parsed.success) {
    return { ok: true, value: parsed.data };
  }
  return { ok: false, error: parsed.error.message };
}
