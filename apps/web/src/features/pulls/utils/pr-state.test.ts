import { describe, expect, it } from "vitest";

import { SupersededStops } from "../types";
import {
  isNoLongerOpen,
  readSupersededStop,
  type SupersededStopSource,
} from "./pr-state";

describe("isNoLongerOpen", () => {
  it.each(["closed", "merged"] as const)("holds for a %s PR", (prState) => {
    expect(isNoLongerOpen(prState)).toBe(true);
  });

  it.each(["open", "unknown"] as const)("stays false for %s", (prState) => {
    expect(isNoLongerOpen(prState)).toBe(false);
  });
});

describe("readSupersededStop", () => {
  const OPEN_INSTALLED: SupersededStopSource = {
    state: "open",
    appInstalled: true,
  };

  it("expects a newer push on an open installation PR", () => {
    expect(readSupersededStop(OPEN_INSTALLED)).toBeUndefined();
  });

  it.each(["closed", "merged"] as const)(
    "stops a %s installation PR",
    (state) => {
      const meta = { ...OPEN_INSTALLED, state };
      expect(readSupersededStop(meta)).toBe(SupersededStops.CLOSED);
    },
  );

  it("never stops a url row, whose worker queues the moved head", () => {
    const meta = {
      ...OPEN_INSTALLED,
      state: "closed",
      appInstalled: false,
    } as const;
    expect(readSupersededStop(meta)).toBeUndefined();
  });
});
