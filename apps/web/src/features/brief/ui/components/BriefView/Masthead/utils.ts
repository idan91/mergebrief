import { type Concern, Concerns, type ConcernRollup } from "brief-core/types";

import { CARD_MIN_PROPERTY, MIN_SPLIT_CONCERNS } from "./consts";
import {
  SplitSegmentKinds,
  type CardMinHeightInput,
  type ConcernShare,
  type SplitSegmentKind,
} from "./types";

interface RemainderLines {
  added: number;
  deleted: number;
}

interface WorkingShare {
  share: ConcernShare;
  remainder: number;
}

/**
 * Vocabulary-ordered concern shares, then the Unattributed remainder when it
 * has leftover lines. Percents apportion over the whole diff (attributed +
 * remainder) by largest remainder, so they always sum to exactly 100.
 */
export function computeConcernShares(
  rollup: ConcernRollup[],
  remainder?: RemainderLines,
): ConcernShare[] {
  const leftoverCount =
    remainder === undefined ? 0 : remainder.added + remainder.deleted;
  const remainderLines = leftoverCount > 0 ? remainder : undefined;
  const attributedTotal = rollup.reduce(
    (sum, entry) => sum + entry.added + entry.deleted,
    0,
  );
  const remainderTotal =
    remainderLines === undefined
      ? 0
      : remainderLines.added + remainderLines.deleted;
  const total = attributedTotal + remainderTotal;

  const byConcern = new Map<Concern, { added: number; deleted: number }>();
  for (const entry of rollup) {
    const current = byConcern.get(entry.concern) ?? { added: 0, deleted: 0 };
    current.added += entry.added;
    current.deleted += entry.deleted;
    byConcern.set(entry.concern, current);
  }

  const working: WorkingShare[] = Object.values(Concerns).flatMap((concern) => {
    const entry = byConcern.get(concern);
    if (entry === undefined) {
      return [];
    }
    return [
      buildWorkingShare(SplitSegmentKinds.CONCERN, entry, total, concern),
    ];
  });

  if (remainderLines !== undefined) {
    working.push(
      buildWorkingShare(
        SplitSegmentKinds.UNATTRIBUTED_REMAINDER,
        remainderLines,
        total,
      ),
    );
  }

  if (total > 0) {
    let leftover =
      100 - working.reduce((sum, item) => sum + item.share.percent, 0);
    const byRemainder = working
      .map((item, index) => ({ remainder: item.remainder, index }))
      .toSorted((a, b) => b.remainder - a.remainder);
    for (const { index } of byRemainder) {
      if (leftover === 0) {
        break;
      }
      const item = working[index];
      if (item === undefined) {
        continue;
      }
      item.share.percent += 1;
      leftover -= 1;
    }
  }

  return working.map((item) => item.share);
}

function buildWorkingShare(
  kind: typeof SplitSegmentKinds.CONCERN,
  lines: RemainderLines,
  total: number,
  concern: Concern,
): WorkingShare;
function buildWorkingShare(
  kind: typeof SplitSegmentKinds.UNATTRIBUTED_REMAINDER,
  lines: RemainderLines,
  total: number,
): WorkingShare;
function buildWorkingShare(
  kind: SplitSegmentKind,
  lines: RemainderLines,
  total: number,
  concern?: Concern,
): WorkingShare {
  const exact = total === 0 ? 0 : ((lines.added + lines.deleted) / total) * 100;
  const percent = Math.floor(exact);
  const leftover = exact - percent;

  if (kind === SplitSegmentKinds.CONCERN && concern !== undefined) {
    return {
      share: {
        kind: SplitSegmentKinds.CONCERN,
        concern,
        added: lines.added,
        deleted: lines.deleted,
        percent,
      },
      remainder: leftover,
    };
  }

  return {
    share: {
      kind: SplitSegmentKinds.UNATTRIBUTED_REMAINDER,
      added: lines.added,
      deleted: lines.deleted,
      percent,
    },
    remainder: leftover,
  };
}

/**
 * The card's held height: the summary, the row gap and the bar stack as it
 * last measured with every bar closed. Undefined until that measurement
 * exists, so the card keeps its natural height. An empty stack measures zero
 * and adds no gap, so the card ends with the summary.
 */
export function computeCardMinHeight({
  summaryHeight,
  rowGap,
  collapsedStackHeight,
}: CardMinHeightInput): number | undefined {
  if (collapsedStackHeight === undefined) {
    return undefined;
  }
  if (collapsedStackHeight === 0) {
    return summaryHeight;
  }

  const heldHeight = summaryHeight + rowGap + collapsedStackHeight;
  return heldHeight;
}

/** Writes the held height on change only, so a frame that measured the same costs nothing. */
export function writeCardMinHeight(
  grid: HTMLElement,
  minHeight: number | undefined,
): void {
  if (minHeight === undefined) {
    grid.style.removeProperty(CARD_MIN_PROPERTY);
    return;
  }

  const next = `${String(minHeight)}px`;
  if (grid.style.getPropertyValue(CARD_MIN_PROPERTY) !== next) {
    grid.style.setProperty(CARD_MIN_PROPERTY, next);
  }
}

/** A Split says something only across two concerns; the remainder does not count. */
export function hasConcernSplit(shares: readonly ConcernShare[]): boolean {
  const concerns = shares.filter(
    (share) => share.kind === SplitSegmentKinds.CONCERN,
  );
  return concerns.length >= MIN_SPLIT_CONCERNS;
}
