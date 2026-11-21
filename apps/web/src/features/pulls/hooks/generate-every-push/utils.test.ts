import { createI18n } from "i18n";
import { describe, expect, it } from "vitest";

import { readEveryPushNotice } from "./utils";

const { t } = createI18n();

describe("readEveryPushNotice", () => {
  it("names the state a save landed in", () => {
    expect(readEveryPushNotice(t, "saved", true)).toBe(
      "Every push on this pull request now generates a brief.",
    );
    expect(readEveryPushNotice(t, "saved", false)).toBe(
      "Pushes on this pull request wait for their conditions again.",
    );
  });

  it("names a refusal the same way whichever way it was turned", () => {
    expect(readEveryPushNotice(t, "not-allowed", true)).toBe(
      readEveryPushNotice(t, "not-allowed", false),
    );
    expect(readEveryPushNotice(t, "indeterminate", true)).toBe(
      "MergeBrief could not confirm this was saved. Reload to see where it stands.",
    );
  });

  it("sends an account the instance does not list to whoever runs it", () => {
    expect(readEveryPushNotice(t, "account-not-allowed", true)).toBe(
      "This GitHub account isn't allowed on this instance. Ask whoever runs it for access.",
    );
  });
});
