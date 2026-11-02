import type { Mutable } from "types/utils";
import type { FetchedPr } from "../../github/types";
import {
  DiagramTypes,
  extractMedia,
  MediaKinds,
  type MediaItem,
  type MediaKey,
} from "../../media";
import {
  isStoredMediaKey,
  SUMMARY_MEDIA_MAX_POINTER_ITEMS,
  SUMMARY_MEDIA_MAX_SHOWN,
  SummaryMediaPositions,
  type SummaryMedia,
  type SummaryMediaGeneration,
  type SummaryMediaPosition,
} from "../../types";
import type {
  PointerContext,
  SummaryMediaResolution,
  SummaryMediaTally,
} from "./types";
import { cleanPointerLabel, readMediaPromptText } from "./utils";

/** The description's Media, read as the page reads it: the numbers the model answers with index this list. */
export function readDescriptionMedia(pr: FetchedPr): MediaItem[] {
  const repoSlug = `${pr.locator.owner}/${pr.locator.repo}`;
  return extractMedia(pr.meta.body, { repoSlug });
}

function quote(text: string): string {
  return JSON.stringify(text);
}

function renderMediaLine(item: MediaItem, index: number): string {
  const fields = [`${index + 1}. ${item.kind}`];
  const isTypedDiagram =
    item.kind === MediaKinds.DIAGRAM && item.diagramType !== DiagramTypes.OTHER;
  if (isTypedDiagram) {
    fields.push(`type: ${item.diagramType}`);
  }

  const caption = readMediaPromptText(item.caption);
  if (caption !== undefined) {
    fields.push(`caption: ${quote(caption)}`);
  }
  const heading = readMediaPromptText(item.heading);
  if (heading !== undefined) {
    fields.push(`heading: ${quote(heading)}`);
  }
  return fields.join(" | ");
}

/**
 * The numbered `<pr_media>` block that follows the description, or nothing
 * when the description holds no Media: one line per item, never an address.
 */
export function renderPrMedia(items: readonly MediaItem[]): string {
  if (items.length === 0) {
    return "";
  }
  const lines = items.map(renderMediaLine).join("\n");
  return `\n<pr_media>\n${lines}\n</pr_media>`;
}

type ShownMedia = SummaryMedia["shown"][number];
type MediaPointer = NonNullable<SummaryMedia["pointer"]>;

function isSummaryMediaPosition(value: string): value is SummaryMediaPosition {
  return Object.values<string>(SummaryMediaPositions).includes(value);
}

/** The key of the 1-based item `number` names, if it names one the stored check accepts. */
function readItemKey(
  number: number,
  items: readonly MediaItem[],
  tally: SummaryMediaTally,
): MediaKey | undefined {
  const key = Number.isInteger(number) ? items[number - 1]?.key : undefined;
  if (key === undefined) {
    tally.unknownNumbers += 1;
    return undefined;
  }
  if (!isStoredMediaKey(key)) {
    tally.unstorableKeys += 1;
    return undefined;
  }
  return key;
}

function readPosition(
  position: string,
  tally: SummaryMediaTally,
): SummaryMediaPosition {
  if (isSummaryMediaPosition(position)) {
    return position;
  }
  tally.unknownPositions += 1;
  return SummaryMediaPositions.AFTER_LEDE;
}

function readShown(
  answer: SummaryMediaGeneration,
  items: readonly MediaItem[],
  tally: SummaryMediaTally,
): ShownMedia[] {
  const shown: ShownMedia[] = [];
  const seen = new Set<MediaKey>();
  for (const entry of answer.shown) {
    const key = readItemKey(entry.item, items, tally);
    if (key === undefined) {
      continue;
    }
    if (seen.has(key)) {
      tally.repeated += 1;
      continue;
    }
    seen.add(key);
    if (shown.length === SUMMARY_MEDIA_MAX_SHOWN) {
      tally.shownPastCap += 1;
      continue;
    }
    shown.push({ key, position: readPosition(entry.position, tally) });
  }
  return shown;
}

function readPointerItems(
  numbers: readonly number[],
  context: PointerContext,
  tally: SummaryMediaTally,
): MediaKey[] {
  const kept: MediaKey[] = [];
  for (const number of numbers) {
    const key = readItemKey(number, context.items, tally);
    if (key === undefined) {
      continue;
    }
    if (context.shownKeys.has(key)) {
      tally.pointerAlreadyShown += 1;
    } else if (kept.includes(key)) {
      tally.repeated += 1;
    } else if (kept.length === SUMMARY_MEDIA_MAX_POINTER_ITEMS) {
      tally.pointerPastCap += 1;
    } else {
      kept.push(key);
    }
  }
  return kept;
}

function readPointer(
  answer: SummaryMediaGeneration,
  context: PointerContext,
  tally: SummaryMediaTally,
): MediaPointer | undefined {
  const label = cleanPointerLabel(answer.pointer.label);
  const isEmptyForm = label === "" && answer.pointer.items.length === 0;
  if (isEmptyForm) {
    return undefined;
  }

  const items = readPointerItems(answer.pointer.items, context, tally);
  const nothingLeft = items.length === 0 || label === "";
  if (nothingLeft) {
    tally.pointerDropped = true;
    return undefined;
  }
  return { label, items };
}

function listTallyIssues(tally: SummaryMediaTally): string[] {
  const counted: [number, string][] = [
    [tally.unknownNumbers, "item number(s) that name no Media item"],
    [tally.unstorableKeys, "item(s) whose key is too long to store"],
    [tally.repeated, "repeated item(s)"],
    [
      tally.shownPastCap,
      `shown item(s) past the first ${SUMMARY_MEDIA_MAX_SHOWN}`,
    ],
    [
      tally.pointerPastCap,
      `pointer item(s) past the first ${SUMMARY_MEDIA_MAX_POINTER_ITEMS}`,
    ],
    [tally.pointerAlreadyShown, "pointer item(s) already shown"],
  ];
  const issues = counted
    .filter(([count]) => count > 0)
    .map(([count, what]) => `summaryMedia: dropped ${count} ${what}`);

  if (tally.unknownPositions > 0) {
    issues.push(
      `summaryMedia: read ${tally.unknownPositions} unknown position(s) as ${SummaryMediaPositions.AFTER_LEDE}`,
    );
  }
  if (tally.pointerDropped) {
    issues.push(
      "summaryMedia: dropped the pointer, which had no items or no label left",
    );
  }
  return issues;
}

/**
 * The model's item numbers mapped to keys and trimmed, never failed: numbers
 * naming nothing go, the first shown and pointer items within the caps stay,
 * repeats and pointer items already shown go, an unknown position reads as
 * after the lede, a pointer with no items or label left goes, and the
 * empty pointer form is the model's "no pointer", read without a warning.
 */
export function resolveSummaryMedia(
  answer: SummaryMediaGeneration | undefined,
  items: readonly MediaItem[],
): SummaryMediaResolution {
  if (answer === undefined) {
    return { issues: [] };
  }

  const tally: SummaryMediaTally = {
    unknownNumbers: 0,
    unstorableKeys: 0,
    repeated: 0,
    shownPastCap: 0,
    pointerPastCap: 0,
    pointerAlreadyShown: 0,
    unknownPositions: 0,
    pointerDropped: false,
  };
  const shown = readShown(answer, items, tally);
  const shownKeys = new Set(shown.map((entry) => entry.key));
  const pointer = readPointer(answer, { items, shownKeys }, tally);
  const issues = listTallyIssues(tally);

  const picksNothing = shown.length === 0 && pointer === undefined;
  if (picksNothing) {
    return { issues };
  }
  const summaryMedia: Mutable<SummaryMedia> = { shown };
  if (pointer !== undefined) {
    summaryMedia.pointer = pointer;
  }
  return { summaryMedia, issues };
}
