// `audit_log` — the append-only compliance boundary. NO outbound FKs (audit
// must survive the target's deletion), numeric-only (never purged, so it must
// hold nothing identifying — no names, no route/method/headers/IP), never
// swept by retention. Append-only is convention; the REVOKE UPDATE/DELETE
// hardening is documented (commented out) in the raw-sql-hardening migration.
//
// `target_type` is intentionally NOT a closed vocabulary.
import { bigint, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import type { AuditAction, AuditActorType, InstallationId } from "../types";

export const auditLog = pgTable("audit_log", {
  id: bigint("id", { mode: "bigint" }).generatedAlwaysAsIdentity().primaryKey(),
  /** Tenant scope; plain column, NOT an FK. */
  installationId: bigint("installation_id", { mode: "bigint" })
    .$type<InstallationId>()
    .notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  actorType: text("actor_type").$type<AuditActorType>().notNull(),
  /** GitHub user id for a reviewer; null for app/system. Loose numeric ref. */
  actorId: bigint("actor_id", { mode: "bigint" }),
  action: text("action").$type<AuditAction>().notNull(),
  targetType: text("target_type"),
  /** Loose numeric ref to the target row — deliberately not an FK. */
  targetId: bigint("target_id", { mode: "bigint" }),
  /** Small semantic, non-PII detail only (e.g. {"decision":"403"}). */
  metadata: jsonb("metadata"),
});
