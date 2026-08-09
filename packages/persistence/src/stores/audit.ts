// The `audit(...)` emit: one immutable, tenant-scoped append per boundary —
// `generate` (worker write), `delete` (purge), `config`, and auth *denials*
// (action `auth` + a decision in metadata). High-volume firehoses (every-request
// auth-success, every-fetch `view`) are excluded — they belong in the purgeable
// web access log, not this never-purged ledger.
//
// NUMERIC-ONLY: the entry carries no name/login/route/method/header/IP —
// nothing identifying, because the log cannot be purged. The only string fields
// are `action` (closed vocabulary) and the open-ended `target_type`.
// `metadata` is guarded by a CLOSED KEY ALLOWLIST — that allowlist (plus the
// short/printable/no-"@" value rules) IS the PII enforcement, not a convention:
// an un-erasable table cannot rely on callers' judgment. There are no
// update/delete helpers — this table is append-only.
import { z } from "zod";
import { type AppDatabase, type AppDrizzle, internal } from "../db/handle";
import { auditLog } from "../schema/audit-log";
import type {
  AuditAction,
  AuditActorType,
  InstallationId,
  ValueOf,
} from "../types";

export type AuditLogRow = typeof auditLog.$inferSelect;

/**
 * The closed metadata-key allowlist. Extending it is a deliberate code change
 * reviewed against the numeric-only rule, never a runtime decision.
 */
export const AuditMetadataKey = {
  DECISION: "decision",
  KIND: "kind",
  REASON_CODE: "reason-code",
  COUNT: "count",
  CONFIG_KEY: "config-key",
  TARGET_KIND: "target-kind",
} as const;
export type AuditMetadataKey = ValueOf<typeof AuditMetadataKey>;

const metadataKeySchema = z.union([
  z.literal(AuditMetadataKey.DECISION),
  z.literal(AuditMetadataKey.KIND),
  z.literal(AuditMetadataKey.REASON_CODE),
  z.literal(AuditMetadataKey.COUNT),
  z.literal(AuditMetadataKey.CONFIG_KEY),
  z.literal(AuditMetadataKey.TARGET_KIND),
]);

/**
 * String values: short, printable ASCII, and never containing "@" — a cheap
 * email guard (this ledger holds numeric ids only; no legitimate metadata
 * value contains an "@").
 */
const metadataStringSchema = z
  .string()
  .max(64)
  .regex(/^[\x20-\x7E]*$/, "printable ASCII only")
  .refine((value) => !value.includes("@"), { message: 'must not contain "@"' });

/**
 * Small, queryable, non-PII detail (e.g. `{"decision":"403"}`). Keys are
 * restricted to the closed `AuditMetadataKey` allowlist — the enforcement,
 * not a convention; values are constrained scalars, never nested objects
 * that could smuggle identifying transport detail into an un-erasable table.
 */
/** Finite only: `Infinity` survives `z.number()` but JSON-serializes to `null`
 * in the jsonb column, silently corrupting a count. */
const metadataNumberSchema = z.number().finite();

export const AuditMetadataSchema = z.record(
  metadataKeySchema,
  z.union([metadataStringSchema, metadataNumberSchema, z.boolean()]),
);

/**
 * `targetType` is deliberately open-ended (`pull_request | brief | …`), but
 * "open-ended" means open CLASS of target, not open TEXT: a class token is
 * lowercase snake_case, ≤64 chars — never a route, slug, email, or any other
 * identifying string. Shape-validated here and CHECK-backstopped in the DB so
 * caller discipline isn't the enforcement.
 */
export const AuditTargetTypeSchema = z
  .string()
  .max(64)
  .regex(
    /^[a-z][a-z0-9_]*$/,
    "targetType must be a lowercase snake_case class token",
  );
/**
 * Declared as a partial record (any subset of the allowlisted keys) — zod v3's
 * `z.record` with a literal key schema would infer every key as required,
 * which is not the runtime contract.
 */
export type AuditMetadata = Partial<
  Record<AuditMetadataKey, string | number | boolean>
>;

/**
 * An audit entry. Compile-time numeric-only guarantee: no string *name* fields
 * beyond the closed `action` and the open `targetType`. `installationId` is the
 * numeric tenant scope (a plain column, NOT an FK); the caller passes
 * `ctx.installationId`.
 */
export interface AuditEntry {
  readonly installationId: InstallationId;
  readonly actorType: AuditActorType;
  /** GitHub user id for a reviewer; omit for app/system. Loose numeric ref. */
  readonly actorId?: bigint;
  readonly action: AuditAction;
  /** Open-ended target class, e.g. `pull_request` | `brief` | `installation`. */
  readonly targetType?: string;
  /** Loose numeric ref to the target row — deliberately not an FK. */
  readonly targetId?: bigint;
  readonly metadata?: AuditMetadata;
}

/**
 * Emit one append-only audit row on the given drizzle executor. In-package
 * interface (NOT re-exported from `index.ts`): a transaction `tx` is assignable
 * to `AppDrizzle`, so a purge routine can append its `delete` entry in the SAME
 * transaction as the deletes it records — the ledger survives because
 * `audit_log` has no FK, and the emit commits atomically with the cascade.
 * Validates `metadata` against the non-PII scalar schema — malformed metadata
 * is a programmer error and throws.
 */
export async function insertAudit(
  executor: AppDrizzle,
  entry: AuditEntry,
): Promise<AuditLogRow> {
  const metadata =
    entry.metadata === undefined
      ? null
      : AuditMetadataSchema.parse(entry.metadata);
  const targetType =
    entry.targetType === undefined
      ? undefined
      : AuditTargetTypeSchema.parse(entry.targetType);
  const rows = await executor
    .insert(auditLog)
    .values({
      installationId: entry.installationId,
      actorType: entry.actorType,
      actorId: entry.actorId,
      action: entry.action,
      targetType,
      targetId: entry.targetId,
      metadata,
    })
    .returning();
  const row = rows[0];
  if (row === undefined) {
    throw new Error("audit_log insert returned no row");
  }
  return row;
}

/**
 * Emit one append-only audit row. Accepts the opaque `AppDatabase`; unwrapped
 * in-package so no raw handle escapes. Convenience over `insertAudit` for
 * single-shot, non-transactional emits.
 */
export async function audit(
  handle: AppDatabase,
  entry: AuditEntry,
): Promise<AuditLogRow> {
  return insertAudit(internal(handle), entry);
}
