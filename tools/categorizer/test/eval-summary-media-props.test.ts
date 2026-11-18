import { describe, expect, it } from "vitest";
import { extractMedia, type MediaKey } from "brief-core/media";
import {
  SummaryMediaPositions,
  type Brief,
  type SummaryMedia,
} from "brief-core/types";
import { buildSummaryMediaGuards } from "../eval/summary-media-props";
import { makeBrief } from "./eval-fixtures";

const DESCRIPTION =
  "![before](https://example.com/before.png)\n\n![after](https://example.com/after.png)";
const OTHER_DESCRIPTION = "![other](https://example.com/other.png)";
const POINTER_LABEL = "Before and after";
const KEYS_NAME_ITEMS = "summary-media-keys-name-items";
const PLACED_ONCE = "summary-media-item-placed-once";

function makeMediaBrief(summaryMedia: SummaryMedia): Brief {
  const base = makeBrief();
  const brief = makeBrief({ pr: { ...base.pr, description: DESCRIPTION } });
  brief.summaryMedia = summaryMedia;
  return brief;
}

function readItemKeys(description: string): MediaKey[] {
  const items = extractMedia(description, { repoSlug: makeBrief().pr.repo });
  return items.map((item) => item.key);
}

function readHeldKeys(): [MediaKey, MediaKey] {
  const [first, second] = readItemKeys(DESCRIPTION);
  if (first === undefined || second === undefined) {
    throw new Error("the description holds two Media items");
  }
  return [first, second];
}

function readForeignKey(): MediaKey {
  const [foreign] = readItemKeys(OTHER_DESCRIPTION);
  if (foreign === undefined) {
    throw new Error("the other description holds a Media item");
  }
  return foreign;
}

function checkGuard(id: string, brief: Brief): boolean {
  const guard = buildSummaryMediaGuards().find(
    (property) => property.id === id,
  );
  if (guard === undefined) {
    throw new Error(`${id} is not a guard`);
  }
  return guard.check(brief);
}

describe("the Summary Media keys-name-items guard", () => {
  it("passes keys the description holds", () => {
    const [first, second] = readHeldKeys();
    const brief = makeMediaBrief({
      shown: [{ key: first, position: SummaryMediaPositions.AFTER_LEDE }],
      pointer: { label: POINTER_LABEL, items: [second] },
    });

    expect(checkGuard(KEYS_NAME_ITEMS, brief)).toBe(true);
  });

  it("fails a shown key the description does not hold", () => {
    const brief = makeMediaBrief({
      shown: [
        { key: readForeignKey(), position: SummaryMediaPositions.AFTER_LEDE },
      ],
    });

    expect(checkGuard(KEYS_NAME_ITEMS, brief)).toBe(false);
  });

  it("fails a pointer key the description does not hold", () => {
    const [first] = readHeldKeys();
    const brief = makeMediaBrief({
      shown: [{ key: first, position: SummaryMediaPositions.AFTER_LEDE }],
      pointer: { label: POINTER_LABEL, items: [readForeignKey()] },
    });

    expect(checkGuard(KEYS_NAME_ITEMS, brief)).toBe(false);
  });
});

describe("the Summary Media placed-once guard", () => {
  it("passes items split between shown and the pointer", () => {
    const [first, second] = readHeldKeys();
    const brief = makeMediaBrief({
      shown: [{ key: first, position: SummaryMediaPositions.AFTER_LEDE }],
      pointer: { label: POINTER_LABEL, items: [second] },
    });

    expect(checkGuard(PLACED_ONCE, brief)).toBe(true);
  });

  it("fails an item both shown and in the pointer", () => {
    const [first] = readHeldKeys();
    const brief = makeMediaBrief({
      shown: [{ key: first, position: SummaryMediaPositions.AFTER_LEDE }],
      pointer: { label: POINTER_LABEL, items: [first] },
    });

    expect(checkGuard(PLACED_ONCE, brief)).toBe(false);
  });
});
