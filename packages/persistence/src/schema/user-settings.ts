// `user_settings` — the SECOND deliberately NON-tenant-scoped table (D14),
// after `audit_log`. Keyed by GitHub's numeric user id (the same id sessions
// carry as `reviewer_id`), because a person spans installations (reviewer in
// one org, author in another; same human either way) — the row therefore
// cannot carry `installation_id` as its key. Reads/writes go through the
// dedicated `userSettingsStore` seam, NOT `forTenant` (see `../user-settings`).
//
// TYPED COLUMNS ONLY, never a JSON preferences blob (D14): every new setting is
// a column + migration, the same closed-vocabulary discipline as the
// CHECK-constrained enums — the table must not rot into a preferences dump. No
// FK to any tenant table (same isolation rationale as `audit_log`'s no-FK rule):
// a dangling `default_installation_id` (installation purged) degrades, never
// binds, and is overwritten on the next switch.
import { bigint, pgTable, timestamp } from "drizzle-orm/pg-core";
import type { InstallationId, ReviewerId } from "../types";

export const userSettings = pgTable("user_settings", {
  /** GitHub's numeric user id — the PK; NOT installation-scoped (D14). */
  ghUserId: bigint("gh_user_id", { mode: "bigint" })
    .$type<ReviewerId>()
    .primaryKey(),
  /**
   * The installation a multi-org reviewer's login binds to when it is still in
   * their live accessible set; nullable (a fresh user has none). A stale value
   * (installation purged) is harmless — login falls back to the first
   * accessible installation and the next switch overwrites it (D14).
   */
  defaultInstallationId: bigint("default_installation_id", {
    mode: "bigint",
  }).$type<InstallationId>(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
