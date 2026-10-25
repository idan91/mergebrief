import { describe, expect, it } from "vitest";

import { appI18n } from "../../../../../i18n/I18nProvider";
import type { SupersededStopSource } from "../../../utils/pr-state";
import {
  readEmptyCopyOverride,
  readSupersededAnnouncementKey,
  type EmptyCopySource,
} from "./utils";

const OPEN_INSTALLED: SupersededStopSource = {
  state: "open",
  appInstalled: true,
  draft: false,
};

describe("readSupersededAnnouncementKey", () => {
  it("announces a newer push on an open installation PR", () => {
    expect(readSupersededAnnouncementKey(OPEN_INSTALLED)).toBe(
      "pulls.announce.superseded",
    );
  });

  it("announces the stop on a closed PR", () => {
    const closed = { ...OPEN_INSTALLED, state: "closed" as const };

    expect(readSupersededAnnouncementKey(closed)).toBe(
      "pulls.announce.supersededNotOpen",
    );
  });
});

describe("readEmptyCopyOverride", () => {
  const HELD_DRAFT: EmptyCopySource = {
    appInstalled: true,
    state: "open",
    draft: true,
    draftPolicy: { generate: false },
    viewerIsAuthor: false,
  };

  it("promises no brief for a held draft, which the author gate may hold", () => {
    const line = readEmptyCopyOverride(appI18n.t, HELD_DRAFT);

    expect(line).toContain("marked ready for review");
    expect(line).not.toMatch(/brief (will )?generates?/i);
  });

  it("hands the draft's author their own drafts-off notice", () => {
    const own = { ...HELD_DRAFT, viewerIsAuthor: true };

    expect(readEmptyCopyOverride(appI18n.t, own)).toBe(
      appI18n.t("pulls.ownDraft.draftsOff"),
    );
  });
});
