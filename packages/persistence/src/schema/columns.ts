// Shared column groups so every table is uniform. Each helper returns FRESH
// builders — Drizzle column builders are stateful and must not be shared
// across tables.
//
// Naming: noun factories, not verb-first, on purpose — they sit in Drizzle's
// DSL register and read as column groups at the spread site.
import { bigint, integer, text, timestamp } from "drizzle-orm/pg-core";
import type { InstallationId } from "../types";

/**
 * Tenant group: surrogate `bigint generated always as identity` PK + the
 * `installation_id` tenant scope. NULLABLE since the url-box world:
 * a NULL marks a row in the owner-scoped world, whose scope anchor is
 * `pull_request.owner_user_id` (children reach it through their PR parent).
 * `TId` brands the PK for tables whose surrogate id is critical
 * (e.g. `PullRequestRowId`).
 */
export function tenantColumns<TId extends bigint = bigint>() {
  return {
    id: bigint("id", { mode: "bigint" })
      .$type<TId>()
      .generatedAlwaysAsIdentity()
      .primaryKey(),
    installationId: bigint("installation_id", {
      mode: "bigint",
    }).$type<InstallationId>(),
  };
}

export function stampColumns() {
  return {
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  };
}

/**
 * Artifact trio: inline `body TEXT` (passthrough, TOASTed) + `byte_size` +
 * `created_at`. No shared blob table — erasure stays a single FK cascade off
 * `pull_request`.
 */
export function artifactColumns() {
  return {
    body: text("body").notNull(),
    byteSize: integer("byte_size").notNull(),
    ...stampColumns(),
  };
}
