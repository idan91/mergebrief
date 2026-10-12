import type { PrSearchChange } from "../../search/types";
import type { PrSummary } from "../../types";
import type { DbTimelineSelection } from "../../utils/dbTimeline";
import type { RevisionPosture, RevisionSpan } from "./types";

const SPAN_SEPARATOR = " ";
const SPANS_SEPARATOR = "\n";

/**
 * Base drift stays read-only because the rendered anchors may be wrong;
 * head drift only needs an acknowledgement.
 */
export function deriveRevisionPosture(
  meta: Pick<PrSummary, "headSha" | "baseSha">,
  timeline: DbTimelineSelection | undefined,
  renderedHead: string | undefined,
): RevisionPosture {
  const selectedHeadIsCurrent =
    timeline !== undefined && timeline.selected.headSha === meta.headSha;
  const selectedBaseIsCurrent =
    timeline !== undefined &&
    (meta.baseSha === undefined || timeline.selected.baseSha === meta.baseSha);
  const staleHead =
    renderedHead !== undefined &&
    meta.headSha !== undefined &&
    meta.headSha !== renderedHead;
  const newerRevisionSelectable =
    timeline === undefined ||
    timeline.selectedIndex < timeline.points.length - 1;
  const baseDrift = selectedHeadIsCurrent && !selectedBaseIsCurrent;

  return {
    baseDrift,
    staleHead,
    newerRevisionSelectable,
  };
}

/** Full-span identity: duplicate-head revisions differ only by base. */
export function deriveSelectedSpanKey(
  timeline: DbTimelineSelection | undefined,
): string | undefined {
  if (timeline === undefined) {
    return undefined;
  }
  const { baseSha, headSha } = timeline.selected;

  return `${baseSha}${SPAN_SEPARATOR}${headSha}`;
}

/** The rev the URL should carry; a degraded request is left as the reviewer followed it. */
export function readPinnedRev(
  timeline: DbTimelineSelection | undefined,
): number | undefined {
  if (timeline === undefined || timeline.degraded) {
    return undefined;
  }

  return timeline.selected.headIndex;
}

/** A bare or legacy-span link is rewritten to its rev. */
export function shouldPinRev(
  search: Pick<PrSearchChange, "rev" | "head" | "base">,
  pinnedRev: number | undefined,
): boolean {
  if (pinnedRev === undefined) {
    return false;
  }
  const legacySpan = search.head !== undefined || search.base !== undefined;
  const rewrites = search.rev !== pinnedRev || legacySpan;

  return rewrites;
}

/** A string, so an equal timeline from a later poll keeps the jump's identity. */
export function buildRevisionSpansKey(
  timeline: DbTimelineSelection | undefined,
): string | undefined {
  if (timeline === undefined) {
    return undefined;
  }

  return timeline.points
    .map(
      (point) => `${point.headSha}${SPAN_SEPARATOR}${String(point.headIndex)}`,
    )
    .join(SPANS_SEPARATOR);
}

/** Hex SHAs and integers cannot collide with the separators. */
export function parseRevisionSpansKey(key: string): RevisionSpan[] {
  return key.split(SPANS_SEPARATOR).map((line) => {
    const [headSha = "", headIndex = ""] = line.split(SPAN_SEPARATOR);

    return { headSha, headIndex: Number(headIndex) };
  });
}

/**
 * Duplicate heads: the highest-index row wins, matching the backend's
 * current-entry choice for the same ambiguity.
 */
export function findJumpRevision(
  spans: readonly RevisionSpan[],
  anchorSha: string,
): number | undefined {
  return spans.findLast((span) => span.headSha === anchorSha)?.headIndex;
}
