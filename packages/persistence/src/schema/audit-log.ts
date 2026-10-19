// `audit_log`, the append-only compliance boundary. NO outbound FKs (audit
// must survive the target's deletion). It holds ids, tokens and numbers only:
// no names, no routes, no headers, no bodies, no addresses. Rows expire only
// under the operator's retention setting.
// `target_type` and `operation` are open vocabularies: `operation` is a
// Product Operation descriptor id, owned by the api package.
import {
  bigint,
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import {
  AuditActorTypes,
  AuditChannels,
  AuditOutcomes,
  type AuditActorType,
  type AuditChannel,
  type AuditClassification,
  type AuditOutcome,
  type InstallationId,
} from "../types";
import { isNullOrOneOf, isOneOf, matchesPattern } from "./checks";
import { AccessLevels } from "types/access-levels";
import {
  PullRequestSources,
  type PullRequestSource,
} from "types/pull-requests";

/** The token shapes the CHECKs below enforce; the audit Zod schemas parse with them too. */
export const AUDIT_OPERATION_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;
export const AUDIT_TARGET_TYPE_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
export const AUDIT_REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
export const AUDIT_CLIENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,63}$/;

const AUDIT_ACTOR_TYPES = Object.values(AuditActorTypes);
const AUDIT_OUTCOMES = Object.values(AuditOutcomes);
const AUDIT_CHANNELS = Object.values(AuditChannels);
const AUDIT_CLASSIFICATIONS = Object.values(AccessLevels).filter(
  (level): level is AuditClassification => level !== AccessLevels.READ,
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: bigint("id", { mode: "bigint" })
      .generatedAlwaysAsIdentity()
      .primaryKey(),
    /** Tenant scope; plain column, NOT an FK. NULL for owner-world entries. */
    installationId: bigint("installation_id", {
      mode: "bigint",
    }).$type<InstallationId>(),
    /** Which world the entry belongs to (mirrors `pull_request.source`). */
    source: text("source")
      .$type<PullRequestSource>()
      .notNull()
      .default(PullRequestSources.INSTALLATION),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    actorType: text("actor_type").$type<AuditActorType>().notNull(),
    /** GitHub user id for a reviewer; null for app/system. Loose numeric ref. */
    actorId: bigint("actor_id", { mode: "bigint" }),
    /** Product Operation descriptor id, an open kebab-case token. */
    operation: text("operation").notNull(),
    outcome: text("outcome").$type<AuditOutcome>().notNull(),
    /** Null off the HTTP path, where no descriptor classification applies. */
    classification: text("classification").$type<AuditClassification>(),
    /** Null off the HTTP path (no credential surface was involved). */
    channel: text("channel").$type<AuditChannel>(),
    /** `api_token.id` or `auth_session.id`, a plain number, not an FK. */
    credentialId: bigint("credential_id", { mode: "bigint" }),
    /** Joins the `api.access` transport line. */
    requestId: text("request_id"),
    /** User-agent-derived, forensic only; nothing may ever branch on it. */
    client: text("client"),
    targetType: text("target_type"),
    /** Loose numeric ref to the target row, deliberately not an FK. */
    targetId: bigint("target_id", { mode: "bigint" }),
    /** Small semantic, non-PII detail only (e.g. {"decision":"403"}). */
    metadata: jsonb("metadata"),
  },
  (table) => {
    const installationSourced = isOneOf(table.source, [
      PullRequestSources.INSTALLATION,
    ]);
    const urlSourced = isOneOf(table.source, [PullRequestSources.URL]);
    const requestIdShaped = matchesPattern(
      table.requestId,
      AUDIT_REQUEST_ID_PATTERN,
    );
    const clientShaped = matchesPattern(table.client, AUDIT_CLIENT_PATTERN);
    const targetTypeShaped = matchesPattern(
      table.targetType,
      AUDIT_TARGET_TYPE_PATTERN,
    );

    return [
      index("audit_log_occurred_at_idx").on(table.occurredAt),
      check(
        "audit_log_source_shape",
        sql`(${installationSourced} and ${table.installationId} is not null) or (${urlSourced} and ${table.installationId} is null)`,
      ),
      check(
        "audit_log_actor_type_check",
        isOneOf(table.actorType, AUDIT_ACTOR_TYPES),
      ),
      check(
        "audit_log_operation_shape",
        matchesPattern(table.operation, AUDIT_OPERATION_PATTERN),
      ),
      check("audit_log_outcome_check", isOneOf(table.outcome, AUDIT_OUTCOMES)),
      check(
        "audit_log_classification_check",
        isNullOrOneOf(table.classification, AUDIT_CLASSIFICATIONS),
      ),
      check(
        "audit_log_channel_check",
        isNullOrOneOf(table.channel, AUDIT_CHANNELS),
      ),
      check(
        "audit_log_request_id_shape",
        sql`${table.requestId} is null or ${requestIdShaped}`,
      ),
      check(
        "audit_log_client_shape",
        sql`${table.client} is null or ${clientShaped}`,
      ),
      check(
        "audit_log_target_type_shape",
        sql`${table.targetType} is null or ${targetTypeShaped}`,
      ),
    ];
  },
);
