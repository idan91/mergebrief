// `user_settings` — deliberately NON-tenant-scoped, like `audit_log`. Keyed
// by GitHub's numeric user id (the same id sessions carry as `reviewer_id`)
// because a person spans installations, so the row cannot key on
// `installation_id`. Reads/writes go through the dedicated
// `createUserSettingsStore` boundary, NOT `createTenantRepository`.
//
// TYPED COLUMNS ONLY, never a JSON preferences blob: every new setting is a
// column + migration, so the table cannot rot into a preferences dump. No FK
// to any tenant table — a dangling `default_installation_id` degrades, never
// binds, and is overwritten on the next switch.
import { bigint, pgTable, timestamp } from "drizzle-orm/pg-core";
import type { InstallationId, ReviewerId } from "../types";

export const userSettings = pgTable("user_settings", {
  /** GitHub's numeric user id — the PK; NOT installation-scoped. */
  ghUserId: bigint("gh_user_id", { mode: "bigint" })
    .$type<ReviewerId>()
    .primaryKey(),
  /**
   * The installation a multi-org reviewer's login binds to when it is still in
   * their live accessible set; nullable (a fresh user has none). A stale value
   * (installation purged) is harmless — login falls back to the first
   * accessible installation and the next switch overwrites it.
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
