// Drive route search params through onSelect using the revision array position.
// A retarget can share a head SHA with a different base, so SHA identity is unsafe.
// The route owns the single polite announcement and focus-to-heading behavior.
import { type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { IconButton } from "@web/components/IconButton/IconButton";
import { ScreenReaderOnly } from "@web/components/ScreenReaderOnly/ScreenReaderOnly";
import type { DbTimelinePoint } from "../../../../../utils/dbTimeline";
import styles from "./DbTimelineNavigator.module.scss";

export interface DbTimelineNavigatorProps {
  /** All points, ordered by `headIndex` ascending (latest last). */
  points: readonly DbTimelinePoint[];
  /** Position of the selected point within `points`, the selection identity. */
  selectedIndex: number;
  previous: DbTimelinePoint | undefined;
  next: DbTimelinePoint | undefined;
  /** Route-owned navigation, receives the selected revision point. */
  onSelect: (point: DbTimelinePoint) => void;
}

function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

/** `position:point`, unique per row even across duplicate heads. */
function pointKey(position: number, point: DbTimelinePoint): string {
  return `${String(position)}:${point.baseSha}:${point.headSha}`;
}

export function DbTimelineNavigator({
  points,
  selectedIndex,
  previous,
  next,
  onSelect,
}: DbTimelineNavigatorProps) {
  const { t } = useTranslation();
  // Only a real timeline (more than one revision) earns a navigator.
  if (points.length < 2) return null;
  // Duplicate heads render identical "Revision N · sha" labels; suffix the
  // base so a retarget re-brief's two rows are tellable apart in the picker.
  const headCounts = new Map<string, number>();
  for (const point of points) {
    headCounts.set(point.headSha, (headCounts.get(point.headSha) ?? 0) + 1);
  }
  /**
   * Left/Right step revisions from ANY control in the navigator, the picker
   * included. Up/Down stay native so the select keeps walking its options.
   */
  const findStepTarget = (key: string): DbTimelinePoint | undefined => {
    if (key === "ArrowLeft") return previous;
    if (key === "ArrowRight") return next;
    if (key === "Home") return points[0];
    if (key === "End") return points[points.length - 1];
    return undefined;
  };
  const stepFromNav = (event: KeyboardEvent<HTMLElement>) => {
    if (event.defaultPrevented) return;
    const target = findStepTarget(event.key);
    if (target === undefined || target === points[selectedIndex]) return;
    event.preventDefault();
    onSelect(target);
  };

  return (
    <nav
      aria-label={t("pulls.timeline.navLabel")}
      className={styles["timeline"]}
    >
      <IconButton
        onKeyDown={stepFromNav}
        // Disabled state keeps a descriptive name, a bare arrow glyph is
        // meaningless to a screen reader.
        label={
          previous
            ? t("pulls.timeline.prevRevision", { index: previous.headIndex })
            : t("pulls.timeline.prevNone")
        }
        aria-disabled={previous === undefined || undefined}
        className={styles["arrow"]}
        size="md"
        variant="outlined"
        onClick={() => previous && onSelect(previous)}
      >
        ←
      </IconButton>
      <label className={styles["picker"]}>
        <ScreenReaderOnly>{t("pulls.timeline.selectLabel")}</ScreenReaderOnly>
        <select
          onKeyDown={stepFromNav}
          onChange={(event) => {
            const point = points[Number(event.target.value)];
            if (point !== undefined) onSelect(point);
          }}
          value={String(selectedIndex)}
        >
          {points.map((point, position) => (
            <option key={pointKey(position, point)} value={String(position)}>
              {t("pulls.timeline.option", {
                index: point.headIndex,
                sha: shortSha(point.headSha),
                total: points.length,
              })}
              {(headCounts.get(point.headSha) ?? 0) > 1
                ? ` ${t("pulls.timeline.optionBaseSuffix", {
                    sha: shortSha(point.baseSha),
                  })}`
                : ""}
            </option>
          ))}
        </select>
      </label>
      <IconButton
        onKeyDown={stepFromNav}
        label={
          next
            ? t("pulls.timeline.nextRevision", { index: next.headIndex })
            : t("pulls.timeline.nextNone")
        }
        aria-disabled={next === undefined || undefined}
        className={styles["arrow"]}
        size="md"
        variant="outlined"
        onClick={() => next && onSelect(next)}
      >
        →
      </IconButton>
    </nav>
  );
}
