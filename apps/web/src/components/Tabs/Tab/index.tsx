import type { KeyboardEvent, MouseEvent, ReactNode } from "react";

import { useTabsContext } from "../context";
import { derivePanelId, deriveTabId, resolveNextIndex } from "../utils";
import styles from "./Tab.module.scss";

export interface TabsTabProps {
  value: string;
  children: ReactNode;
}

/**
 * Roving tabindex: arrows move and select with wrap-around, Home/End jump,
 * Tab leaves the row. A vertical list also takes the side arrows, because
 * the rail lays out as a row on a narrow screen.
 */
function moveAmongSiblings(event: KeyboardEvent<HTMLButtonElement>): void {
  const list = event.currentTarget.closest('[role="tablist"]');
  const tabs = Array.from(
    list?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? [],
  );
  const index = tabs.indexOf(event.currentTarget);
  const vertical = list?.getAttribute("aria-orientation") === "vertical";
  const next = tabs[resolveNextIndex(event.key, index, tabs.length, vertical)];
  if (!next) {
    return;
  }

  event.preventDefault();
  next.focus();
  next.click();
}

export function TabsTab({ value, children }: TabsTabProps) {
  const { value: selectedValue, baseId, select, variant } = useTabsContext();
  const selected = value === selectedValue;
  // Safari never focuses a clicked button, so focus alone would leave a tab
  // half under the edge of a row that scrolls.
  const selectTab = (event: MouseEvent<HTMLButtonElement>) => {
    event.currentTarget.scrollIntoView({ block: "nearest", inline: "nearest" });
    select(value);
  };

  return (
    <button
      aria-controls={derivePanelId(baseId, value)}
      aria-selected={selected}
      className={styles["tab"]}
      data-variant={variant}
      id={deriveTabId(baseId, value)}
      role="tab"
      tabIndex={selected ? 0 : -1}
      type="button"
      onClick={selectTab}
      onKeyDown={moveAmongSiblings}
    >
      {children}
    </button>
  );
}
