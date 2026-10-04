// `user_settings.dismissed_version`: per user, keyed by GitHub user id across
// installations; absent until the first dismiss, replaced by a later one.
import { describe, expect, it } from "vitest";
import { createUserSettingsStore } from "../src/stores/user-settings";
import { isReviewerId } from "../src/types";
import { brandWith, freshDatabase } from "./helpers";

const DANA = brandWith(isReviewerId, 777001n);
const SAM = brandWith(isReviewerId, 777002n);

describe("user settings store", () => {
  it("reads no dismissed version for a user with no row", async () => {
    const store = createUserSettingsStore(await freshDatabase());

    expect(await store.readDismissedVersion(DANA)).toBeUndefined();
  });

  it("stores the dismissed version and reads it back", async () => {
    const store = createUserSettingsStore(await freshDatabase());

    await store.setDismissedVersion(DANA, "1.6.0");

    expect(await store.readDismissedVersion(DANA)).toBe("1.6.0");
    expect(await store.readDismissedVersion(SAM)).toBeUndefined();
  });

  it("replaces an earlier dismissal", async () => {
    const store = createUserSettingsStore(await freshDatabase());
    await store.setDismissedVersion(DANA, "1.6.0");

    await store.setDismissedVersion(DANA, "1.7.0");

    expect(await store.readDismissedVersion(DANA)).toBe("1.7.0");
  });
});
