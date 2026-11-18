import type { useInteractions } from "@floating-ui/react";
import { createContext, useContext, type MutableRefObject } from "react";

import type { DropdownRole, DropdownSelection } from "./types";

/** What the rows and the panel read from a Dropdown root. */
export interface DropdownContextValue {
  readonly role: DropdownRole;
  readonly selection: DropdownSelection | undefined;
  readonly activeIndex: number | null;
  readonly elementsRef: MutableRefObject<(HTMLElement | null)[]>;
  readonly labelsRef: MutableRefObject<(string | null)[]>;
  readonly getItemProps: ReturnType<typeof useInteractions>["getItemProps"];
  /** A ticked row reports its index so a listbox opens on the lowest one. */
  readonly markSelected: (index: number, selected: boolean) => void;
  readonly close: () => void;
}

export const DropdownContext = createContext<DropdownContextValue | null>(null);

export function useDropdownContext(): DropdownContextValue {
  const value = useContext(DropdownContext);
  if (value === null) {
    throw new Error("Dropdown parts render inside a Dropdown or Menu root");
  }
  return value;
}
