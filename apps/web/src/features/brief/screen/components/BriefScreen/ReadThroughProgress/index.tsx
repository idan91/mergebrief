import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { GroupView } from "../../../../model/utils/viewModel";
import { resolveGroupName } from "../../../../model/utils/resolveGroupName";
import { useReadingPosition } from "../readingPosition";
import { deriveFillStyle, revealSegment } from "./utils";
import styles from "./ReadThroughProgress.module.scss";

export interface ReadThroughSegment {
  groupId: string;
  position: number;
  title: string;
  firstChunkId: string | undefined;
  /** 0–100; within-group chunk position, not review completion. */
  fillPercent: number;
  isCurrent: boolean;
  isPast: boolean;
}

/**
 * Pure derivation of the segmented Read-through progress bar from the
 * (already Reading-order-sorted, or source-order-fallback) groups and the
 * active chunk. Position-in-sequence only, never completion, never rank.
 * Extracted so segment math is unit-testable without rendering.
 */
export function buildReadThroughSegments(
  groups: GroupView[],
  activeChunkId: string | null,
  groupTitle: (group: GroupView) => string,
): ReadThroughSegment[] {
  const activeGroupIndex = groups.findIndex((group) =>
    group.chunks.some((chunk) => chunk.id === activeChunkId),
  );
  return groups.map((group, index) => {
    const isCurrent = index === activeGroupIndex;
    const isPast = activeGroupIndex >= 0 && index < activeGroupIndex;
    let fillPercent = 0;
    if (isPast) {
      fillPercent = 100;
    } else if (isCurrent && group.chunks.length > 0) {
      const chunkIndex = group.chunks.findIndex(
        (chunk) => chunk.id === activeChunkId,
      );
      fillPercent = ((chunkIndex + 1) / group.chunks.length) * 100;
    }
    return {
      groupId: group.id,
      position: index + 1,
      title: groupTitle(group),
      firstChunkId: group.chunks[0]?.id,
      fillPercent,
      isCurrent,
      isPast,
    };
  });
}

export interface ReadThroughProgressProps {
  groups: GroupView[];
  jumpToChunk: (chunkId: string) => void;
}

/**
 * Segmented position-in-sequence indicator for Read-through, one segment per
 * (Reading-order or source-order) group. Distinct from the top review-
 * completion stats, this never implies importance/priority/severity (no-
 * verdict rule): fill tracks where the reader is, not how much is done.
 * Segments are click-to-jump navigation to each group's first chunk.
 */
export function ReadThroughProgress({
  groups,
  jumpToChunk,
}: ReadThroughProgressProps) {
  const { t } = useTranslation();
  const activeChunkId = useReadingPosition((state) => state.activeChunkId);
  const navRef = useRef<HTMLElement>(null);
  const segments = buildReadThroughSegments(groups, activeChunkId, (group) =>
    resolveGroupName(t, group),
  );
  const currentIndex = segments.findIndex((segment) => segment.isCurrent);

  // The nav scrolls, with its scrollbar hidden, once the segments outgrow it.
  useEffect(() => {
    const nav = navRef.current;
    const current = nav?.children[currentIndex];
    if (nav && current instanceof HTMLElement) {
      revealSegment(nav, current);
    }
  }, [currentIndex]);

  if (segments.length === 0) {
    return null;
  }
  const complete =
    segments.length > 0 && segments[segments.length - 1]?.isCurrent
      ? segments[segments.length - 1]?.fillPercent === 100
      : false;
  return (
    <nav
      aria-label={t("brief.progress.ariaLabel")}
      className={styles["progress"]}
      ref={navRef}
      data-complete={complete ? "" : undefined}
    >
      {segments.map((segment) => {
        const label = t("brief.progress.segmentLabel", {
          index: segment.position,
          total: segments.length,
          title: segment.title,
        });
        const fillStyle = deriveFillStyle(segment.fillPercent);
        const jump = () => {
          if (segment.firstChunkId) {
            jumpToChunk(segment.firstChunkId);
          }
        };

        return (
          // oxlint-disable-next-line house/no-raw-button -- progress segment as click target: the hit area is not a visual control
          <button
            aria-current={segment.isCurrent ? "step" : undefined}
            aria-label={label}
            className={styles["segment"]}
            data-current={segment.isCurrent ? "" : undefined}
            data-past={segment.isPast ? "" : undefined}
            key={segment.groupId}
            type="button"
            onClick={jump}
          >
            <span className={styles["fill"]} style={fillStyle} />
          </button>
        );
      })}
    </nav>
  );
}
