import type { KeyboardEvent, ReactNode } from "react";

import { useTabsContext } from "../context";
import { derivePanelId, deriveTabId, resolveNextIndex } from "../utils";
import styles from "./Tab.module.scss";

export interface TabsTabProps {
  value: string;
  children: ReactNode;
}

/** Roving tabindex: arrows move and select with wrap-around, Home/End jump, Tab leaves the row. */
function moveAmongSiblings(event: KeyboardEvent<HTMLButtonElement>): void {
  const list = event.currentTarget.closest('[role="tablist"]');
  const tabs = Array.from(
    list?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? [],
  );
  const index = tabs.indexOf(event.currentTarget);
  const next = tabs[resolveNextIndex(event.key, index, tabs.length)];
  if (!next) return;

  event.preventDefault();
  next.focus();
  next.click();
}

export function TabsTab({ value, children }: TabsTabProps) {
  const { value: selectedValue, baseId, select } = useTabsContext();
  const selected = value === selectedValue;

  return (
    <button
      aria-controls={derivePanelId(baseId, value)}
      aria-selected={selected}
      className={styles["tab"]}
      id={deriveTabId(baseId, value)}
      role="tab"
      tabIndex={selected ? 0 : -1}
      type="button"
      onClick={() => select(value)}
      onKeyDown={moveAmongSiblings}
    >
      {children}
    </button>
  );
}
