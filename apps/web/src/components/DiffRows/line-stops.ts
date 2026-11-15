import {
  IN_TAB_ORDER,
  LINE_STOP_ATTRIBUTE,
  LINE_STOP_COLUMNS,
  LINE_STOP_SELECTOR,
  OFF_TAB_ORDER,
  TAB_ENTRY_STOPS,
} from "./consts";
import { type LineStop, LineStops, type SplitSide } from "./types";

type LineStep = (
  column: readonly HTMLElement[],
  position: number,
) => HTMLElement | undefined;

/** Where each key steps to within one column of a table's line stops. */
const LINE_STEPS: Record<string, LineStep> = {
  ArrowUp: (column, position) => column[position - 1],
  ArrowDown: (column, position) => column[position + 1],
  Home: (column) => column[0],
  End: (column) => column.at(-1),
};

/** The line stop an event landed on; a control inside a line is not one. */
export function readLineStop(
  target: EventTarget | null,
): HTMLElement | undefined {
  const isStop =
    target instanceof HTMLElement && target.hasAttribute(LINE_STOP_ATTRIBUTE);
  return isStop ? target : undefined;
}

function listLineStops(body: HTMLElement): HTMLElement[] {
  return [...body.querySelectorAll<HTMLElement>(LINE_STOP_SELECTOR)];
}

function readLineStopKind(stop: HTMLElement): LineStop | undefined {
  const value = stop.getAttribute(LINE_STOP_ATTRIBUTE);
  return Object.values(LineStops).find((kind) => kind === value);
}

/** The column a line stop steps within; a unified row has none. */
export function readLineStopColumn(stop: HTMLElement): SplitSide | undefined {
  const kind = readLineStopKind(stop);
  return kind === undefined ? undefined : LINE_STOP_COLUMNS[kind];
}

/**
 * Leaves exactly one of the table's stops in the Tab order and returns it:
 * `preferred` while the table still holds it, else the first Tab entry.
 */
export function syncTabStop(
  body: HTMLElement,
  preferred: HTMLElement | undefined,
): HTMLElement | undefined {
  const stops = listLineStops(body);
  const firstTabStop = stops.find((stop) =>
    TAB_ENTRY_STOPS.has(stop.getAttribute(LINE_STOP_ATTRIBUTE) ?? ""),
  );
  const held = preferred !== undefined && stops.includes(preferred);
  const tabStop = held ? preferred : firstTabStop;

  for (const stop of stops) {
    const tabIndex = stop === tabStop ? IN_TAB_ORDER : OFF_TAB_ORDER;
    if (stop.tabIndex !== tabIndex) {
      stop.tabIndex = tabIndex;
    }
  }
  return tabStop;
}

/** The line stop in `column` on the row that holds `stop`. */
export function findRowStop(
  stop: HTMLElement,
  column: SplitSide,
): HTMLElement | undefined {
  const cells = stop.closest("tr")?.children ?? [];
  for (const cell of cells) {
    const rowStop = readLineStop(cell);
    if (rowStop !== undefined && readLineStopColumn(rowStop) === column) {
      return rowStop;
    }
  }
  return undefined;
}

/** The stop `key` steps to from `from`, within its column. */
export function findLineStep(
  body: HTMLElement,
  from: HTMLElement,
  key: string,
): HTMLElement | undefined {
  const step = LINE_STEPS[key];
  if (step === undefined) {
    return undefined;
  }
  const fromColumn = readLineStopColumn(from);
  const column = listLineStops(body).filter(
    (stop) => readLineStopColumn(stop) === fromColumn,
  );
  return step(column, column.indexOf(from));
}
