import type { ReactNode } from "react";
import type { ValueOf } from "types/utils";

import type { FilterOption } from "../../types";

/** What a filter trigger's `data-state` says: at its default, or changed. */
export const FilterStates = {
  DEFAULT: "default",
  CHANGED: "changed",
} as const;
export type FilterState = ValueOf<typeof FilterStates>;

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
  /** Print the choice at its default too; a sort is always on something. */
  readonly alwaysNamed?: boolean;
  /** How many choices print by name before the control prints a count. */
  readonly namedUpTo?: number;
  readonly glyphs?: Readonly<Record<string, ReactNode>>;
  readonly onChoose: (value: Value) => void;
}
