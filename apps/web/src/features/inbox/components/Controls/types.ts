import type { ReactNode } from "react";
import type { ValueOf } from "types/utils";

import type { FilterOption } from "../../types";

/** What a filter trigger's `data-state` says: at its default, or changed. */
export const FilterStates = {
  DEFAULT: "default",
  CHANGED: "changed",
} as const;
export type FilterState = ValueOf<typeof FilterStates>;

/**
 * A filter's first row: every option at once. Ticked while the filter holds
 * nothing narrower, and inert then, since there is no narrower state to
 * leave it for; the trigger prints `triggerLabel` in its place.
 */
export interface FilterAllRow {
  readonly label: string;
  readonly triggerLabel: string;
  readonly checked: boolean;
  readonly onChoose: () => void;
}

/** One filter as the controls draw it: its name, its options and what is chosen. */
export interface FilterView<Value extends string = string> {
  readonly id: string;
  readonly name: string;
  readonly options: readonly FilterOption<Value>[];
  readonly chosen: readonly Value[];
  /** Any number of options may be chosen; otherwise exactly one is. */
  readonly multiple: boolean;
  /** Off its default, so the control takes the accent. */
  readonly changed: boolean;
  /** Sits behind More filters on a wide viewport; every filter shares one sheet on a narrow one. */
  readonly underMore?: boolean;
  /** Print the choice at its default too; a sort is always on something. */
  readonly alwaysNamed?: boolean;
  /** How many choices print by name before the control prints a count. */
  readonly namedUpTo?: number;
  readonly glyphs?: Readonly<Record<string, ReactNode>>;
  readonly all?: FilterAllRow;
  readonly onChoose: (value: Value) => void;
}
