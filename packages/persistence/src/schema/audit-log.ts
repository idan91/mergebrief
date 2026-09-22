// `audit_log`, the append-only compliance boundary. NO outbound FKs (audit
// must survive the target's deletion). It holds ids, tokens and numbers only:
// no names, no routes, no headers, no bodies. `caller_ip` is the one
// identifying field, NULLABLE so that collecting it is a config change and
// never a migration. Rows expire only under the operator's retention setting.
// `target_type` and `operation` are open vocabularies: `operation` is a
// Product Operation descriptor id, owned by the api package.
import { bigint, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import {
  PullRequestSources,
  type PullRequestSource,
  type AuditActorType,
  type AuditChannel,
  type AuditClassification,
  type AuditOutcome,
  type InstallationId,
} from "../types";

export const auditLog = pgTable("audit_log", {
  id: bigint("id", { mode: "bigint" }).generatedAlwaysAsIdentity().primaryKey(),
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
  /** Socket address; populated only under the operator's PII flag. */
  callerIp: text("caller_ip"),
  targetType: text("target_type"),
  /** Loose numeric ref to the target row, deliberately not an FK. */
  targetId: bigint("target_id", { mode: "bigint" }),
  /** Small semantic, non-PII detail only (e.g. {"decision":"403"}). */
  metadata: jsonb("metadata"),
});
