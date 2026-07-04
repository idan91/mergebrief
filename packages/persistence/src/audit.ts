// The `audit(...)` emit (ADR 0018 D9): one immutable, tenant-scoped append per
// M1 boundary — `generate` (worker write), `delete` (purge), `config`, and auth
// *denials* (action `auth` + a decision in metadata). High-volume firehoses
// (every-request auth-success, every-fetch `view`) are excluded — they belong
// in the purgeable web access log, not this never-purged ledger.
//
// NUMERIC-ONLY (D1/D9): the entry carries no name/login/route/method/header/IP
// — nothing identifying, because the log cannot be purged. The only string
// fields are `action` (closed vocabulary) and the open-ended `target_type`.
// `metadata` is guarded by a CLOSED KEY ALLOWLIST — that allowlist (plus the
// short/printable/no-"@" value rules) IS the PII enforcement, not a
// convention: an un-erasable table cannot rely on callers' judgment. There are
// no update/delete helpers — append-only by convention (the
// `REVOKE UPDATE/DELETE` is the hosted hardening step).
import { z } from "zod";
import { type AppDatabase, internal } from "./db.js";
import { auditLog } from "./schema/audit-log.js";
import type { AuditAction, AuditActorType, InstallationId, ValueOf } from "./types.js";

export type AuditLogRow = typeof auditLog.$inferSelect;

/**
 * The closed metadata-key allowlist. Covers the M1 emits (generate | delete |
 * config | auth-denial); extending it is a deliberate code change reviewed
 * against the numeric-only rule, never a runtime decision.
 */
export const AuditMetadataKey = {
  decision: "decision",
  kind: "kind",
  reasonCode: "reason_code",
  count: "count",
  configKey: "config_key",
  targetKind: "target_kind",
} as const;
export type AuditMetadataKey = ValueOf<typeof AuditMetadataKey>;

const metadataKeySchema = z.union([
  z.literal(AuditMetadataKey.decision),
  z.literal(AuditMetadataKey.kind),
  z.literal(AuditMetadataKey.reasonCode),
  z.literal(AuditMetadataKey.count),
  z.literal(AuditMetadataKey.configKey),
  z.literal(AuditMetadataKey.targetKind),
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
export const AuditMetadataSchema = z.record(
  metadataKeySchema,
  z.union([metadataStringSchema, z.number(), z.boolean()]),
);
/**
 * Declared as a partial record (any subset of the allowlisted keys) — zod v3's
 * `z.record` with a literal key schema would infer every key as required,
 * which is not the runtime contract.
 */
export type AuditMetadata = Partial<Record<AuditMetadataKey, string | number | boolean>>;

/**
 * An audit entry. Compile-time numeric-only guarantee: no string *name* fields
 * beyond the closed `action` and the open `targetType`. `installationId` is the
 * numeric tenant scope (a plain column, NOT an FK — D9); the caller passes
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
 * Emit one append-only audit row. Validates `metadata` against the non-PII
 * scalar schema (Zod boundary) — malformed metadata is a programmer error and
 * throws. Accepts the opaque `AppDatabase`; unwrapped in-package so no raw
 * handle escapes (D2b).
 */
export async function audit(handle: AppDatabase, entry: AuditEntry): Promise<AuditLogRow> {
  const db = internal(handle);
  const metadata = entry.metadata === undefined ? null : AuditMetadataSchema.parse(entry.metadata);
  const rows = await db
    .insert(auditLog)
    .values({
      installationId: entry.installationId,
      actorType: entry.actorType,
      actorId: entry.actorId,
      action: entry.action,
      targetType: entry.targetType,
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
