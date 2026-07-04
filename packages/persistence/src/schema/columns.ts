// Shared column groups (ADR 0018 implementation notes): factor `tenant`
// (surrogate identity PK + installation_id), `stamps` (created_at), and the
// artifact trio (body + byte_size + created_at) so every table is uniform.
// Each helper returns FRESH builders — Drizzle column builders are stateful
// and must not be shared across tables.
import { bigint, integer, text, timestamp } from "drizzle-orm/pg-core";
import type { InstallationId } from "../types.js";

/**
 * Tenant group (D2a/D2b): surrogate `bigint generated always as identity`
 * PK + the mandatory `installation_id` tenant scope. `TId` brands the PK
 * for tables whose surrogate id is load-bearing (e.g. `PullRequestRowId`).
 */
export function tenantColumns<TId extends bigint = bigint>() {
  return {
    id: bigint("id", { mode: "bigint" }).$type<TId>().generatedAlwaysAsIdentity().primaryKey(),
    installationId: bigint("installation_id", { mode: "bigint" }).$type<InstallationId>().notNull(),
  };
}

/** Stamps group: `created_at timestamptz not null default now()`. */
export function stampColumns() {
  return {
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  };
}

/**
 * Artifact trio (D6): inline `body TEXT` (passthrough, TOASTed) +
 * `byte_size` + `created_at`. No shared blob table — erasure stays a
 * single FK cascade off `pull_request`.
 */
export function artifactColumns() {
  return {
    body: text("body").notNull(),
    byteSize: integer("byte_size").notNull(),
    ...stampColumns(),
  };
}
