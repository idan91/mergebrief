import type { BriefChunk } from "../../types";
import type { RevisionRun } from "../../revisionChanges";

export interface RevisionGutterCellProps {
  run: RevisionRun | undefined;
  isStart: boolean;
  isEnd: boolean;
  chunk: BriefChunk;
  onRailEnter: (run: RevisionRun, el: HTMLElement) => void;
  onRailLeave: () => void;
}

export function RevisionGutterCell({
  run,
  isStart,
  isEnd,
  onRailEnter,
  onRailLeave,
}: RevisionGutterCellProps) {
  if (!run) return <td className="gut" />;
  const count = run.rowIndexes.length;
  const verb = run.kind === "removed" ? "Removed" : "New";
  const railClass = ["rail", isStart && "rail-first", isEnd && "rail-last"]
    .filter(Boolean)
    .join(" ");
  return (
    <td
      className={`gut rev ${run.kind}`}
      onMouseEnter={(e) => onRailEnter(run, e.currentTarget)}
      onMouseLeave={onRailLeave}
    >
      {isStart ? (
        <button
          className="railbtn-focus"
          type="button"
          aria-label={`${verb} this revision. ${count} line${count === 1 ? "" : "s"}.`}
          onFocus={(e) => onRailEnter(run, e.currentTarget)}
          onBlur={onRailLeave}
          onKeyDown={(e) => {
            if (e.key === "Escape") e.currentTarget.blur();
          }}
        />
      ) : null}
      <span className={railClass} aria-hidden="true" />
    </td>
  );
}
