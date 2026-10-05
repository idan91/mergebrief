// Shared column groups. Each helper returns FRESH builders: Drizzle column
// builders are stateful and must not be shared across tables. Noun names on
// purpose; they read as column groups at the spread site.
import {
  bigint,
  integer,
  text,
  timestamp,
  type PgIntegerBuilderInitial,
} from "drizzle-orm/pg-core";
import type { InstallationId } from "../types";

type BodyVersionColumn = PgIntegerBuilderInitial<"body_version">;

/** The surrogate identity PK; `TId` brands it where the id is critical. */
export function idColumn<TId extends bigint = bigint>() {
  return bigint("id", { mode: "bigint" })
    .$type<TId>()
    .generatedAlwaysAsIdentity()
    .primaryKey();
}

/**
 * The PK plus the `installation_id` tenant scope, NULL for the owner-scoped
 * world anchored on `pull_request.owner_user_id`. Credential rows take
 * `idColumn` alone: no credential holds an installation.
 */
export function tenantColumns<TId extends bigint = bigint>() {
  return {
    id: idColumn<TId>(),
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

/** The body's shape version; NULL for a body written before versioning or by an older writer. */
export function bodyVersionColumn(): BodyVersionColumn {
  return integer("body_version");
}

/** Inline `body` plus `byte_size` and `created_at`; erasure stays one FK cascade. */
export function artifactColumns() {
  return {
    body: text("body").notNull(),
    byteSize: integer("byte_size").notNull(),
    ...stampColumns(),
  };
}
