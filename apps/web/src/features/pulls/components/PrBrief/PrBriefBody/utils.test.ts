import { describe, expect, it } from "vitest";

import type { SupersededStopSource } from "../../../utils/pr-state";
import { readSupersededAnnouncementKey } from "./utils";

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
