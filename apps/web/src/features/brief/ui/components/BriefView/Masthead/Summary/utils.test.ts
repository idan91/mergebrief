import { MediaKinds, type MediaKey } from "brief-core/media";
import { SummaryMediaPositions } from "brief-core/types";
import { describe, expect, it } from "vitest";

import type { StripEntry } from "../MediaStrip/types";
import { placeSummaryMedia } from "./utils";

const FIRST = "https://github.com/user-attachments/assets/first" as MediaKey;
const SECOND = "https://github.com/user-attachments/assets/second" as MediaKey;
const THIRD = "https://github.com/user-attachments/assets/third" as MediaKey;
const STALE = "https://github.com/user-attachments/assets/stale" as MediaKey;

function makeEntry(key: MediaKey): StripEntry {
  return { kind: MediaKinds.IMAGE, key, source: key };
}

const ENTRIES = [FIRST, SECOND, THIRD].map(makeEntry);

describe("placeSummaryMedia", () => {
  it("places nothing when the brief has no Summary Media", () => {
    expect(placeSummaryMedia(undefined, ENTRIES)).toEqual({
      beforeLede: [],
      afterLede: [],
    });
  });

  it("places each shown item at its position, in stored order", () => {
    const placed = placeSummaryMedia(
      {
        shown: [
          { key: SECOND, position: SummaryMediaPositions.AFTER_LEDE },
          { key: FIRST, position: SummaryMediaPositions.BEFORE_LEDE },
        ],
      },
      ENTRIES,
    );

    expect(placed.beforeLede.map((entry) => entry.key)).toEqual([FIRST]);
    expect(placed.afterLede.map((entry) => entry.key)).toEqual([SECOND]);
  });

  it("drops a shown key the strip holds no entry for", () => {
    const placed = placeSummaryMedia(
      {
        shown: [
          { key: STALE, position: SummaryMediaPositions.AFTER_LEDE },
          { key: THIRD, position: SummaryMediaPositions.AFTER_LEDE },
        ],
      },
      ENTRIES,
    );

    expect(placed.afterLede.map((entry) => entry.key)).toEqual([THIRD]);
  });

  it("points at the set's first item the strip still holds", () => {
    const placed = placeSummaryMedia(
      {
        shown: [],
        pointer: { label: "Before and after", items: [STALE, THIRD, SECOND] },
      },
      ENTRIES,
    );

    expect(placed.pointer).toEqual({
      label: "Before and after",
      firstItemKey: THIRD,
    });
  });

  it("drops the pointer when none of its items is in the strip", () => {
    const placed = placeSummaryMedia(
      { shown: [], pointer: { label: "Before and after", items: [STALE] } },
      ENTRIES,
    );

    expect(placed.pointer).toBeUndefined();
  });
});
