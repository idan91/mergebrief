// The per-user settings boundary. Like `sessionAuth` and `audit`, this is a
// NON-tenant surface: deliberately NOT ctx-bound and NOT reachable through
// `forTenant`, because `user_settings` is keyed by GitHub user id, not
// `installation_id` (a person spans installations). It still takes the opaque
// `AppDatabase`, unwraps via the in-package `internal()`, and exposes no raw
// query surface.
//
// The only setting today is `default_installation_id` — the installation a
// multi-org reviewer's login binds to when it is still in their live accessible
// set. Typed columns only, never a JSON blob.
import { eq } from "drizzle-orm";
import { type AppDatabase, internal } from "../db/handle";
import { userSettings } from "../schema/user-settings";
import type { InstallationId, ReviewerId } from "../types";

export type UserSettingsRow = typeof userSettings.$inferSelect;

export interface UserSettingsStore {
  /**
   * Read a user's settings row by GitHub user id. Absence is a normal
   * `undefined` (a user who has never set a default has no row).
   */
  get(ghUserId: ReviewerId): Promise<UserSettingsRow | undefined>;
  /**
   * Idempotently upsert the user's default installation. Creates the row on
   * first write, updates + bumps `updated_at` thereafter. The caller has
   * ALREADY validated the target is in the viewer's live accessible set
   * (NEVER trust an unvalidated id here — this boundary only persists).
   */
  setDefaultInstallation(
    ghUserId: ReviewerId,
    defaultInstallationId: InstallationId,
  ): Promise<UserSettingsRow>;
}

/**
 * Build the non-tenant, user-id-keyed settings store over the opaque
 * `AppDatabase`. Uses the in-package `internal()` unwrap; never exposes a raw
 * query surface, and is intentionally NOT ctx-bound (see the file header).
 */
export function userSettingsStore(handle: AppDatabase): UserSettingsStore {
  const db = internal(handle);

  return {
    async get(ghUserId) {
      const rows = await db
        .select()
        .from(userSettings)
        .where(eq(userSettings.ghUserId, ghUserId))
        .limit(1);
      return rows[0];
    },

    async setDefaultInstallation(ghUserId, defaultInstallationId) {
      const rows = await db
        .insert(userSettings)
        .values({ ghUserId, defaultInstallationId, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: userSettings.ghUserId,
          set: { defaultInstallationId, updatedAt: new Date() },
        })
        .returning();
      const row = rows[0];
      if (row === undefined) {
        throw new Error("user_settings upsert returned no row");
      }
      return row;
    },
  };
}
