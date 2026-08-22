// The `audit(...)` emit: one immutable, tenant-scoped append per boundary.
// There are no update/delete helpers — this table is append-only, and only the
// instance-wide retention sweep removes from it.
//
// IDS, TOKENS AND NUMBERS: an entry says what was DONE; a body is what was
// SAID, and every body already lives in the row the entry points at. The only
// identifying field is `caller_ip`, written solely under the operator PII
// flag.
//
// `metadata` takes ANY key and CLOSED values — a token, a finite number, or a
// boolean. The value rules are the enforcement; the key list they replaced only
// made every new emit a code change in this package.
import { z } from "zod";
import { type AppDatabase, type AppDrizzle, internal } from "../db/handle";
import { auditLog } from "../schema/audit-log";
import type {
  AuditActorType,
  AuditChannel,
  AuditClassification,
  AuditOutcome,
  InstallationId,
  ValueOf,
} from "../types";

export type AuditLogRow = typeof auditLog.$inferSelect;

/**
 * Conventional metadata key names. Naming only — keys are open; the value
 * rules below are what protects the ledger.
 */
export const AuditMetadataKey = {
  DECISION: "decision",
  KIND: "kind",
  COUNT: "count",
  REASON: "reason",
} as const;
export type AuditMetadataKey = ValueOf<typeof AuditMetadataKey>;

/** Any snake_case token. */
const metadataKeySchema = z
  .string()
  .max(64)
  .regex(/^[a-z][a-z0-9_]*$/, "metadata keys must be snake_case tokens");

/**
 * String values are enum TOKENS — lowercase kebab-case, never free text: a
 * token cannot carry a name, a route, an address or a body into a ledger an
 * operator may keep forever.
 */
const metadataTokenSchema = z
  .string()
  .max(64)
  .regex(/^[a-z0-9][a-z0-9-]*$/, "string values must be kebab-case tokens");

/** Finite only: `Infinity` survives `z.number()` but JSON-serializes to `null`
 * in the jsonb column, silently corrupting a count. */
const metadataNumberSchema = z.number().finite();

/**
 * Small, queryable, non-PII detail (e.g. `{"decision":"403"}`): open keys,
 * closed values — token, finite number, or boolean. Nothing else, so no
 * nested object or array can smuggle identifying transport detail in.
 */
export const AuditMetadataSchema = z.record(
  metadataKeySchema,
  z.union([metadataTokenSchema, metadataNumberSchema, z.boolean()]),
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
 * `operation` is an open descriptor-id vocabulary, so it is shape-checked
 * rather than value-checked: a kebab-case token carries no route or address
 * into a ledger the operator may keep forever. CHECK-backstopped in the DB.
 */
export const AuditOperationSchema = z
  .string()
  .max(64)
  .regex(
    /^[a-z][a-z0-9-]*$/,
    "operation must be a kebab-case descriptor id token",
  );

/**
 * The forensic call-shape strings, mirroring their DB CHECKs so validation is
 * never the database's alone. All three are tokens, never free text: a
 * correlation id, a `product/version` label nothing may branch on, and an
 * address. The caller sets the user-agent `client` derives from, so a raw
 * header carrying a name or an email must fail here rather than land in a
 * ledger the operator may keep forever.
 */
export const AuditRequestIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,64}$/, "requestId must be a correlation token");
export const AuditClientSchema = z
  .string()
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9._/-]{0,63}$/,
    "client must be a product/version token",
  );
const AuditCallerIpSchema = z
  .string()
  .regex(/^[0-9a-fA-F.:]{1,45}$/, "callerIp must be an IP address");

/** Open keys, closed value types — the schema is the runtime enforcement. */
export type AuditMetadata = Readonly<Record<string, string | number | boolean>>;

/**
 * An audit entry. Every string field is a bounded token — `operation`,
 * `targetType` and the metadata values are shape-checked here and again by a
 * DB CHECK. `installationId` is the numeric tenant scope (a plain column, NOT
 * an FK); the caller passes `ctx.installationId`.
 */
export interface AuditEntry {
  readonly installationId: InstallationId;
  readonly actorType: AuditActorType;
  /** GitHub user id for a reviewer; omit for app/system. Loose numeric ref. */
  readonly actorId?: bigint;
  /**
   * Product Operation descriptor id. Open vocabulary (the descriptors live in
   * the api package), shape-checked as a kebab-case token here and in the DB.
   */
  readonly operation: string;
  readonly outcome: AuditOutcome;
  /** Where the write landed. Omitted off the HTTP path. */
  readonly classification?: AuditClassification;
  /** The credential surface the call arrived on. Omitted off the HTTP path. */
  readonly channel?: AuditChannel;
  /** `api_token.id` or `auth_session.id`. Loose numeric ref, not an FK. */
  readonly credentialId?: bigint;
  /** Joins the `api.access` transport line. */
  readonly requestId?: string;
  /** User-agent-derived, forensic only — never branch on it. */
  readonly client?: string;
  /** Socket address; supplied only under the operator PII flag. */
  readonly callerIp?: string;
  /** Open-ended target class, e.g. `pull_request` | `brief` | `installation`. */
  readonly targetType?: string;
  /** Loose numeric ref to the target row — deliberately not an FK. */
  readonly targetId?: bigint;
  readonly metadata?: AuditMetadata;
}

function parseOptional(
  schema: z.ZodType<string>,
  value: string | undefined,
): string | undefined {
  return value === undefined ? undefined : schema.parse(value);
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
      operation: AuditOperationSchema.parse(entry.operation),
      outcome: entry.outcome,
      classification: entry.classification,
      channel: entry.channel,
      credentialId: entry.credentialId,
      requestId: parseOptional(AuditRequestIdSchema, entry.requestId),
      client: parseOptional(AuditClientSchema, entry.client),
      callerIp: parseOptional(AuditCallerIpSchema, entry.callerIp),
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
