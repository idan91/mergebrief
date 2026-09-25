// Drive route search params through onSelect using the revision array position.
// A retarget can share a head SHA with a different base, so SHA identity is unsafe.
// The route owns the single polite announcement and focus-to-heading behavior.
import { type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { IconButton } from "@web/components/IconButton";
import { TimelinePicker } from "@web/components/TimelinePicker";
import type { DbTimelinePoint } from "../../../../../utils/dbTimeline";
import { Icon } from "@web/components/Icon";
import {
  IconNames,
  IconRotations,
  IconSizes,
} from "@web/components/Icon/types";
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
   * included. Up/Down are the picker's own: they open and walk its list.
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
  const describePoint = (point: DbTimelinePoint): string => {
    const base = t("pulls.timeline.option", {
      index: point.headIndex,
      sha: shortSha(point.headSha),
      total: points.length,
    });
    if ((headCounts.get(point.headSha) ?? 0) < 2) return base;
    const suffix = t("pulls.timeline.optionBaseSuffix", {
      sha: shortSha(point.baseSha),
    });
    return `${base} ${suffix}`;
  };
  const pointOptions = points.map((point, position) => ({
    value: String(position),
    label: describePoint(point),
  }));
  const selectPosition = (value: string) => {
    const point = points[Number(value)];
    if (point !== undefined) onSelect(point);
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
        onClick={() => previous && onSelect(previous)}
      >
        <Icon
          name={IconNames.ARROW_UP}
          rotation={IconRotations.THREE_QUARTERS}
          size={IconSizes.MD}
        />
      </IconButton>
      <TimelinePicker
        label={t("pulls.timeline.selectLabel")}
        options={pointOptions}
        value={String(selectedIndex)}
        onKeyDown={stepFromNav}
        onValueChange={selectPosition}
      />
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
        onClick={() => next && onSelect(next)}
      >
        <Icon
          name={IconNames.ARROW_UP}
          rotation={IconRotations.QUARTER}
          size={IconSizes.MD}
        />
      </IconButton>
    </nav>
  );
}
