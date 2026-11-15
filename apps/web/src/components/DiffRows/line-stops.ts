import {
  IN_TAB_ORDER,
  LINE_STOP_ATTRIBUTE,
  LINE_STOP_COLUMNS,
  LINE_STEPPING_STATE,
  LINE_STOP_SELECTOR,
  OFF_TAB_ORDER,
  READER_INPUT_EVENTS,
  TAB_ENTRY_STOPS,
} from "./consts";
import { type LineStop, LineStops, type SplitSide } from "./types";

type LineStep = (
  column: readonly HTMLElement[],
  position: number,
) => HTMLElement | undefined;

/** Instant: a held arrow key restarts a smooth scroll on every repeat. */
const REVEALED_LINE_SCROLL: ScrollIntoViewOptions = {
  block: "nearest",
  inline: "nearest",
  behavior: "instant",
};

/**
 * Frames a reveal is repeated for. A step that scrolls new cards in makes the
 * card list measure them a frame or two later, and its own scroll correction
 * then lands over the step's, from an offset older than the step.
 */
export const REVEAL_FRAME_BUDGET = 6;

let cancelPendingReveal: (() => void) | undefined;

const READER_INPUT_LISTENER = { capture: true, passive: true } as const;

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

function scrollStopClear(stop: HTMLElement): void {
  stop.dataset["state"] = LINE_STEPPING_STATE;
  stop.scrollIntoView(REVEALED_LINE_SCROLL);
  delete stop.dataset["state"];
}

/**
 * Scrolls a focused line clear of the pinned bars. The browser scrolls a
 * focused line only once it leaves the viewport, and a bar hides it long
 * before that; the mark carries the margin for these scrolls only, so a
 * scroll to target never takes it. Repeated while the line keeps focus: a
 * line already clear does not move. The reader's next input ends the
 * repeats, so a wheel or a key right after a step is never scrolled back.
 */
export function revealLineStop(stop: HTMLElement): void {
  cancelPendingReveal?.();
  scrollStopClear(stop);

  let framesLeft = REVEAL_FRAME_BUDGET;
  let frame = 0;
  const endReveal = () => {
    cancelAnimationFrame(frame);
    for (const type of READER_INPUT_EVENTS) {
      window.removeEventListener(type, endReveal, READER_INPUT_LISTENER);
    }
    cancelPendingReveal = undefined;
  };
  const repeatReveal = () => {
    const holdsFocus = stop.ownerDocument.activeElement === stop;
    if (!holdsFocus) {
      endReveal();
      return;
    }
    scrollStopClear(stop);
    framesLeft -= 1;
    if (framesLeft > 0) {
      frame = requestAnimationFrame(repeatReveal);
    } else {
      endReveal();
    }
  };

  // Capture: the key press that made this step has already passed the window.
  for (const type of READER_INPUT_EVENTS) {
    window.addEventListener(type, endReveal, READER_INPUT_LISTENER);
  }
  frame = requestAnimationFrame(repeatReveal);
  cancelPendingReveal = endReveal;
}
