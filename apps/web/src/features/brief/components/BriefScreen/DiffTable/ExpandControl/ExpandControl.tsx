import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import type { TranslationKey } from "i18n";
import { useId, type MouseEvent, type ReactNode } from "react";

import { IconButton } from "@web/components/IconButton/IconButton";
import {
  type ExpandableEdge,
  type ExpanderStep,
  ExpansionDirections,
  type LineRange,
} from "../../../../types";
import { resolveReachableLines } from "../../../../utils/expansionState";
import { EXPAND_STEP } from "../../../../utils/expandRows";
import {
  useExpandEdge,
  type ExpandEdgeControl,
  type ExpandFailure,
} from "../../../../hooks/useExpandEdge";
import ExpandUpIcon from "./expand-up.svg?react";
import ExpandDownIcon from "./expand-down.svg?react";
import styles from "./ExpandControl.module.scss";

/** What a click just did, for the table to keep the reader's place. */
export interface ExpandedEvent {
  edgeKey: string;
  range: LineRange;
  /** The control's row top before the rows landed, viewport-relative. */
  top: number;
  row: HTMLTableRowElement | null;
}

export interface ExpandControlProps {
  /** The edges this gap exposes: up, down, or both. */
  edges: readonly ExpandableEdge[];
  path: string;
  columnCount: number;
  /** The hunk header this control shares its row with, if any. */
  header?: string | undefined;
  /** Head-file lines of shipped threads the gap hides. */
  hiddenThreadLines?: readonly number[] | undefined;
  /** Fires at click time, before the read, so the landing is known when rows arrive. */
  onExpanded: (event: ExpandedEvent) => void;
  /** The read failed: the landing registered for this edge is off. */
  onAbandoned?: ((edgeKey: string) => void) | undefined;
}

/** Stands in for a side the gap has no edge on; its step is never taken. */
const NO_EDGE: ExpandableEdge = {
  rowIndex: -1,
  gap: {
    edge: { rowIndex: -1, direction: ExpansionDirections.UP },
    from: 1,
    to: 0,
    offset: 0,
  },
  edgeKey: "",
  expansion: undefined,
};

const FAILURE_KEYS: Record<ExpandFailure, TranslationKey> = {
  "too-large": "brief.diff.expandTooLarge",
  "not-text": "brief.diff.expandNotText",
  "not-found": "brief.diff.expandNotFound",
  unavailable: "brief.diff.expandUnavailable",
};

/**
 * The spanning cell of a hunk row, or of a row of its own: one arrow per
 * edge of the gap, the header text when there is one, and a count of the
 * shipped threads the gap hides.
 */
export function ExpandControl({
  edges,
  path,
  columnCount,
  header,
  hiddenThreadLines,
  onExpanded,
  onAbandoned,
}: ExpandControlProps) {
  const up = edges.find(
    (edge) => edge.gap.edge.direction === ExpansionDirections.UP,
  );
  const down = edges.find(
    (edge) => edge.gap.edge.direction === ExpansionDirections.DOWN,
  );
  const { t } = useTranslation();
  const reachable = resolveReachableLines(edges);
  const hidden = countHiddenThreads(reachable, hiddenThreadLines);
  const upControl = useExpandEdge({ edge: up ?? NO_EDGE, path });
  const downControl = useExpandEdge({ edge: down ?? NO_EDGE, path });
  const noteId = useId();
  const failures = listFailures(upControl.failure, downControl.failure);
  const resolveNoteId = (failure: ExpandFailure | undefined) =>
    failure === undefined ? undefined : `${noteId}-${failure}`;
  const nearest = nearestEdge(edges, reachable, hiddenThreadLines ?? []);
  const nearestIsUp = nearest !== undefined && nearest === up;
  const chipControl = nearestIsUp ? upControl : downControl;

  return (
    <td
      className={styles["cell"]}
      colSpan={columnCount}
      data-testid="expand-control"
    >
      <div className={styles["lane"]}>
        <span className={styles["arrows"]}>
          {up !== undefined ? (
            <ExpandArrow
              control={upControl}
              edge={up}
              noteId={resolveNoteId(upControl.failure)}
              onAbandoned={onAbandoned}
              onExpanded={onExpanded}
            />
          ) : null}
          {down !== undefined ? (
            <ExpandArrow
              control={downControl}
              edge={down}
              noteId={resolveNoteId(downControl.failure)}
              onAbandoned={onAbandoned}
              onExpanded={onExpanded}
            />
          ) : null}
        </span>
        {header !== undefined ? (
          <span className={styles["header"]}>{header}</span>
        ) : null}
        {hidden > 0 ? (
          <HiddenThreadsChip
            control={chipControl}
            count={hidden}
            edge={nearest}
            noteId={resolveNoteId(chipControl.failure)}
            onAbandoned={onAbandoned}
            onExpanded={onExpanded}
          />
        ) : null}
      </div>
      {failures.map((failure) => (
        <p
          className={styles["note"]}
          id={resolveNoteId(failure)}
          key={failure}
          role="status"
        >
          {t(FAILURE_KEYS[failure])}
        </p>
      ))}
    </td>
  );
}

interface ExpandArrowProps {
  edge: ExpandableEdge;
  control: ExpandEdgeControl;
  /** This arrow's failure note, once there is one; a click retries the read. */
  noteId: string | undefined;
  onExpanded: (event: ExpandedEvent) => void;
  onAbandoned: ((edgeKey: string) => void) | undefined;
}

function ExpandArrow({
  edge,
  control,
  noteId,
  onExpanded,
  onAbandoned,
}: ExpandArrowProps) {
  const { t } = useTranslation();
  const direction = edge.gap.edge.direction;
  if (control.step === undefined) return null;
  const label = resolveArrowLabel(t, edge, control.step);
  const icon: ReactNode =
    direction === ExpansionDirections.UP ? (
      <ExpandUpIcon aria-hidden="true" />
    ) : (
      <ExpandDownIcon aria-hidden="true" />
    );

  return (
    <IconButton
      aria-busy={control.busy || undefined}
      aria-describedby={noteId}
      aria-label={label}
      data-direction={direction}
      disabled={control.busy}
      label={label}
      onClick={(event) =>
        startExpansion(event, edge, control, onExpanded, onAbandoned)
      }
    >
      {icon}
    </IconButton>
  );
}

/**
 * One click: the landing (row, top, range) is registered BEFORE the read,
 * because the store write that lands the rows renders on its own, and the
 * table's layout effect has to find the landing on that commit.
 */
async function startExpansion(
  event: MouseEvent<HTMLButtonElement>,
  edge: ExpandableEdge,
  control: ExpandEdgeControl,
  onExpanded: (landing: ExpandedEvent) => void,
  onAbandoned: ((edgeKey: string) => void) | undefined,
): Promise<void> {
  const step = control.step;
  if (step === undefined) return;
  const row = event.currentTarget.closest("tr");
  onExpanded({
    edgeKey: edge.edgeKey,
    range: { start: step.range.from, end: step.range.to },
    top: row?.getBoundingClientRect().top ?? 0,
    row,
  });
  const landed = await control.expand();
  if (!landed) onAbandoned?.(edge.edgeKey);
}

interface HiddenThreadsChipProps {
  count: number;
  edge: ExpandableEdge | undefined;
  /** The nearest arrow's control: one busy state and one note serve both. */
  control: ExpandEdgeControl;
  noteId: string | undefined;
  onExpanded: (event: ExpandedEvent) => void;
  onAbandoned: ((edgeKey: string) => void) | undefined;
}

function HiddenThreadsChip({
  count,
  edge,
  control,
  noteId,
  onExpanded,
  onAbandoned,
}: HiddenThreadsChipProps) {
  const { t } = useTranslation();
  const label = t("brief.diff.expandHiddenThreads", { count });
  if (edge === undefined || control.step === undefined) {
    return <span className={styles["plain"]}>{label}</span>;
  }

  return (
    // oxlint-disable-next-line house/no-raw-button -- a pill with text, not an icon button; Button's sizes overshoot a 22px row
    <button
      aria-busy={control.busy || undefined}
      aria-describedby={noteId}
      className={styles["threads"]}
      data-testid="expand-threads"
      disabled={control.busy}
      onClick={(event) =>
        startExpansion(event, edge, control, onExpanded, onAbandoned)
      }
      type="button"
    >
      {label}
    </button>
  );
}

/** One note per distinct refusal: both arrows failing the same way share it. */
function listFailures(
  ...failures: (ExpandFailure | undefined)[]
): ExpandFailure[] {
  const distinct: ExpandFailure[] = [];
  for (const failure of failures) {
    if (failure !== undefined && !distinct.includes(failure)) {
      distinct.push(failure);
    }
  }

  return distinct;
}

function resolveArrowLabel(
  t: TFunction,
  edge: ExpandableEdge,
  step: ExpanderStep | undefined,
): string {
  const isUp = edge.gap.edge.direction === ExpansionDirections.UP;
  if (step === undefined) return "";
  const span = step.range.to - step.range.from + 1;
  if (step.takesAll) {
    return t(isUp ? "brief.diff.expandAllUp" : "brief.diff.expandAllDown", {
      count: span,
    });
  }

  return t(isUp ? "brief.diff.expandUp" : "brief.diff.expandDown", {
    count: EXPAND_STEP,
  });
}

/** Threads whose head-file line a click at this gap can still reveal. */
function countHiddenThreads(
  reachable: readonly LineRange[],
  lines: readonly number[] | undefined,
): number {
  if (lines === undefined || lines.length === 0) return 0;

  return lines.filter((line) => isInside(line, reachable)).length;
}

function isInside(line: number, ranges: readonly LineRange[]): boolean {
  return ranges.some((range) => line >= range.start && line <= range.end);
}

/** The edge whose next read lands nearer the hidden threads. */
function nearestEdge(
  edges: readonly ExpandableEdge[],
  reachable: readonly LineRange[],
  lines: readonly number[],
): ExpandableEdge | undefined {
  const inside = lines.filter((line) => isInside(line, reachable));
  if (inside.length === 0) return undefined;
  const nearestLine = Math.min(...inside);
  const farthestLine = Math.max(...inside);
  const down = edges.find(
    (edge) => edge.gap.edge.direction === ExpansionDirections.DOWN,
  );
  const up = edges.find(
    (edge) => edge.gap.edge.direction === ExpansionDirections.UP,
  );
  const downStart = down?.expansion?.range.end ?? down?.gap.from;
  const upEnd = up?.expansion?.range.start ?? up?.gap.to;
  const fromTop = downStart === undefined ? Infinity : nearestLine - downStart;
  const fromBottom = upEnd === undefined ? Infinity : upEnd - farthestLine;

  return fromTop <= fromBottom ? (down ?? up) : (up ?? down);
}
