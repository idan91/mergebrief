// Shared column groups (ADR 0018 implementation notes): factor `tenant`
// (surrogate identity PK + installation_id), `stamps` (created_at), and the
// artifact trio (body + byte_size + created_at) so every table is uniform.
// Each helper returns FRESH builders — Drizzle column builders are stateful
// and must not be shared across tables.
//
// Naming: these are noun factories, not verb-first functions, on purpose.
// They sit in Drizzle's DSL register (`bigint()`, `text()`, `timestamp()`)
// and read as column groups at the spread site (`...tenantColumns()`).
// The package-wide rule (see ../../AGENTS.md): pure returns-a-thing factories
// in builder/DSL position are nouns; anything that acts or has effects is
// verb-first (`loadConfig`, `encryptToken`, `sanitizeGenerationError`).
import { bigint, integer, text, timestamp } from "drizzle-orm/pg-core";
import type { InstallationId } from "../types";

/**
 * Tenant group (D2a/D2b): surrogate `bigint generated always as identity`
 * PK + the mandatory `installation_id` tenant scope. `TId` brands the PK
 * for tables whose surrogate id is critical (e.g. `PullRequestRowId`).
 */
export function tenantColumns<TId extends bigint = bigint>() {
  return {
    id: bigint("id", { mode: "bigint" })
      .$type<TId>()
      .generatedAlwaysAsIdentity()
      .primaryKey(),
    installationId: bigint("installation_id", { mode: "bigint" })
      .$type<InstallationId>()
      .notNull(),
  };
}

/** Stamps group: `created_at timestamptz not null default now()`. */
export function stampColumns() {
  return {
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
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
