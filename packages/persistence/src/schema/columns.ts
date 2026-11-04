// Shared column groups. Each helper returns FRESH builders: Drizzle column
// builders are stateful and must not be shared across tables. Noun names on
// purpose; they read as column groups at the spread site.
import type { NotNull } from "drizzle-orm";
import {
  bigint,
  customType,
  integer,
  timestamp,
  type PgIntegerBuilderInitial,
} from "drizzle-orm/pg-core";
import { cleanJsonText } from "../db/json-text";
import type { InstallationId } from "../types";

type BodyVersionColumn = NotNull<PgIntegerBuilderInitial<"body_version">>;

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

/** The body's shape version, stamped by every writer with the shape it wrote. */
export function bodyVersionColumn(): BodyVersionColumn {
  return integer("body_version").notNull();
}

/**
 * A JSON document read and written whole: `text`, not `jsonb`, because no query
 * reads inside it and the API serves the stored text as it is. Each table pairs
 * it with an `IS JSON` CHECK. A value SQL must filter on takes a column of its own.
 */
export const jsonDocument = customType<{ data: string; driverData: string }>({
  dataType() {
    return "text";
  },
  toDriver: cleanJsonText,
});

/** Inline `body` and `created_at`; erasure stays one FK cascade. */
export function artifactColumns() {
  return {
    body: jsonDocument("body").notNull(),
    ...stampColumns(),
  };
}
