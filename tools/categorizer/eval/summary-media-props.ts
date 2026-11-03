import { extractMedia, type MediaKey } from "brief-core/media";
import type { Brief } from "brief-core/types";
import type { EvalProperty } from "./properties";

/**
 * Property builders for the Summary Media cases. The item list is read from
 * the brief's own description the way generation reads it, so an item's place
 * in that list is the number the model saw in `<pr_media>`.
 */

/** The description's Media keys in `<pr_media>` order. */
export function listDescriptionMediaKeys(brief: Brief): MediaKey[] {
  const items = extractMedia(brief.pr.description, {
    repoSlug: brief.pr.repo,
  });
  return items.map((item) => item.key);
}

export function listShownKeys(brief: Brief): MediaKey[] {
  return brief.summaryMedia?.shown.map((entry) => entry.key) ?? [];
}

export function listPointerKeys(brief: Brief): MediaKey[] {
  return brief.summaryMedia?.pointer?.items ?? [];
}

/**
 * Generator guarantees, never model judgment: every stored key names a
 * description item, and no item is both shown and in the pointer. Any
 * failure is a resolver bug.
 */
export function buildSummaryMediaGuards(): EvalProperty[] {
  return [
    {
      id: "summary-media-keys-name-items",
      description:
        "every shown and pointer key names a Media item the description holds",
      check: (brief) => {
        const itemKeys = new Set(listDescriptionMediaKeys(brief));
        const storedKeys = [...listShownKeys(brief), ...listPointerKeys(brief)];
        return storedKeys.every((key) => itemKeys.has(key));
      },
    },
    {
      id: "summary-media-item-placed-once",
      description: "no Media item is both shown and in the pointer",
      check: (brief) => {
        const shownKeys = new Set(listShownKeys(brief));
        return listPointerKeys(brief).every((key) => !shownKeys.has(key));
      },
    },
  ];
}
