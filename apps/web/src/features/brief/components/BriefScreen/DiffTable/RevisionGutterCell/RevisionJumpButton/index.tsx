import { useTranslation } from "react-i18next";

import {
  comparisonRunKey,
  REVISION_JUMP_ATTR,
  type ComparisonRun,
} from "../../../../../comparison/runs";

export interface RevisionJumpButtonProps {
  run: ComparisonRun;
  /** The gutter's own class: its focus ring lights the sibling rail. */
  className: string | undefined;
  onRailEnter: (run: ComparisonRun, el: HTMLElement) => void;
  onRailLeave: (el: HTMLElement) => void;
}

/**
 * The labelled control at the start of a revision run. Its own component
 * so the label's translation subscription exists per run, not per row.
 */
export function RevisionJumpButton({
  run,
  className,
  onRailEnter,
  onRailLeave,
}: RevisionJumpButtonProps) {
  const { t } = useTranslation();
  const count = run.rowIndexes.length;
  const railKey =
    run.kind === "removed" ? "brief.diff.railRemoved" : "brief.diff.railNew";

  return (
    // oxlint-disable-next-line house/no-raw-button -- invisible gutter overlay: the hit area is not the visual element
    <button
      className={className}
      {...{ [REVISION_JUMP_ATTR]: comparisonRunKey(run) }}
      type="button"
      aria-label={t(railKey, { count })}
      onFocus={(e) => onRailEnter(run, e.currentTarget)}
      onBlur={(e) => onRailLeave(e.currentTarget)}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.currentTarget.blur();
        }
      }}
    />
  );
}
