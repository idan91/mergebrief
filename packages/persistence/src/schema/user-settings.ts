// `user_settings`, deliberately NON-tenant-scoped like `audit_log`: keyed by
// GitHub's numeric user id (the same id sessions carry as `reviewer_id`)
// because a person spans installations. It holds no setting today; the next
// one is a TYPED COLUMN plus a migration and its own store, never a JSON
// preferences blob, and never a reference into a tenant table.
import { bigint, pgTable, timestamp } from "drizzle-orm/pg-core";
import type { ReviewerId } from "../types";

export const userSettings = pgTable("user_settings", {
  /** GitHub's numeric user id, the PK; NOT installation-scoped. */
  ghUserId: bigint("gh_user_id", { mode: "bigint" })
    .$type<ReviewerId>()
    .primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
