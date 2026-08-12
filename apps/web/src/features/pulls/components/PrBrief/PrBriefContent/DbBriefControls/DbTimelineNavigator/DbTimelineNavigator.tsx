// The DB-path Brief revision navigator over PR-meta's `revisions[]`. Unlike
// the local TimelineNavigator (a path param), this one drives the route's
// search params through `onSelect`.
//
// Selection identity is the POINT (its array position), never a head SHA
// alone — a retarget re-brief yields two revisions with the same head and
// different bases, so a SHA-keyed picker could not address both.
//
// A11y: the polite selection announcement and focus-to-heading are the
// ROUTE's job (one live region per page) — this component only emits the
// controls.
import { type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { ScreenReaderOnly } from "@web/components/ScreenReaderOnly/ScreenReaderOnly";
import type { DbTimelinePoint } from "../../../../../utils/dbTimeline";
import styles from "./DbTimelineNavigator.module.scss";

export interface DbTimelineNavigatorProps {
  /** All points, ordered by `headIndex` ascending (latest last). */
  points: readonly DbTimelinePoint[];
  /** Position of the selected point within `points` — the selection identity. */
  selectedIndex: number;
  previous: DbTimelinePoint | undefined;
  next: DbTimelinePoint | undefined;
  /** Route-owned navigation — receives the selected revision point. */
  onSelect: (point: DbTimelinePoint) => void;
}

/**
 * Identifies a control across the remount a selection causes — the brief
 * subtree is keyed by brief id, so these very nodes are destroyed and rebuilt
 * whenever the reviewer steps. Behavioral hook, not styling or test
 * selection; the route reads it to put focus back where the reviewer left it.
 */
export const REVISION_NAV_CONTROL_ATTR = "data-revnav";

/** The tokens `REVISION_NAV_CONTROL_ATTR` carries. */
export const RevisionNavControls = {
  PREVIOUS: "prev",
  NEXT: "next",
  PICKER: "picker",
} as const;

function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

/** `position:point` — unique per row even across duplicate heads. */
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
  const stepFromNav = (event: KeyboardEvent<HTMLElement>) => {
    if (event.defaultPrevented) return;
    const target =
      event.key === "ArrowLeft"
        ? previous
        : event.key === "ArrowRight"
          ? next
          : event.key === "Home"
            ? points[0]
            : event.key === "End"
              ? points[points.length - 1]
              : undefined;
    if (target === undefined || target === points[selectedIndex]) return;
    event.preventDefault();
    onSelect(target);
  };

  return (
    <nav
      aria-label={t("pulls.timeline.navLabel")}
      className={styles["timeline"]}
    >
      <button
        data-revnav={RevisionNavControls.PREVIOUS}
        onKeyDown={stepFromNav}
        // Disabled state keeps a descriptive name — a bare arrow glyph is
        // meaningless to a screen reader.
        aria-label={
          previous
            ? t("pulls.timeline.prevRevision", { index: previous.headIndex })
            : t("pulls.timeline.prevNone")
        }
        aria-disabled={previous === undefined || undefined}
        className={styles["arrow"]}
        onClick={() => previous && onSelect(previous)}
        type="button"
      >
        ←
      </button>
      <label className={styles["picker"]}>
        <ScreenReaderOnly>{t("pulls.timeline.selectLabel")}</ScreenReaderOnly>
        <select
          data-revnav={RevisionNavControls.PICKER}
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
      <button
        data-revnav={RevisionNavControls.NEXT}
        onKeyDown={stepFromNav}
        aria-label={
          next
            ? t("pulls.timeline.nextRevision", { index: next.headIndex })
            : t("pulls.timeline.nextNone")
        }
        aria-disabled={next === undefined || undefined}
        className={styles["arrow"]}
        onClick={() => next && onSelect(next)}
        type="button"
      >
        →
      </button>
    </nav>
  );
}
