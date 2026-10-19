// Per-user settings, keyed by GitHub user id and NOT tenant-scoped: a person
// spans installations. One typed column per setting; the row is created by
// the first write.
import { eq } from "drizzle-orm";
import { traceStore } from "./trace-store";
import { type AppDatabase, internal } from "../db/handle";
import { userSettings } from "../schema/user-settings";
import type { ReviewerId } from "../types";

export interface UserSettingsStore {
  /** The release the user dismissed the version notice for; absent until they do. */
  readDismissedVersion(ghUserId: ReviewerId): Promise<string | undefined>;
  /** Replace the dismissed release; the row is created on first write. */
  setDismissedVersion(ghUserId: ReviewerId, version: string): Promise<void>;
}

export function createUserSettingsStore(
  handle: AppDatabase,
): UserSettingsStore {
  const db = internal(handle);

  return traceStore("userSettings", {
    async readDismissedVersion(ghUserId) {
      const rows = await db
        .select({ dismissedVersion: userSettings.dismissedVersion })
        .from(userSettings)
        .where(eq(userSettings.ghUserId, ghUserId))
        .limit(1);
      return rows[0]?.dismissedVersion ?? undefined;
    },
    async setDismissedVersion(ghUserId, version) {
      await db
        .insert(userSettings)
        .values({ ghUserId, dismissedVersion: version })
        .onConflictDoUpdate({
          target: userSettings.ghUserId,
          set: { dismissedVersion: version, updatedAt: new Date() },
        });
    },
  });
}
