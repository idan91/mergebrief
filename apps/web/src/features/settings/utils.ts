import {
  SettingsTabIds,
  type SettingsSearch,
  type SettingsTab,
  type SettingsTabId,
} from "./types";

function isSettingsTabId(value: unknown): value is SettingsTabId {
  const known = Object.values(SettingsTabIds).some((id) => id === value);
  return known;
}

/** `?tab=` as the address spells it; an unknown value reads as no choice. */
export function parseSettingsSearch(
  search: Record<string, unknown>,
): SettingsSearch {
  const tab = search["tab"];
  if (!isSettingsTabId(tab)) {
    return {};
  }
  return { tab };
}

function canOpenTab(tab: SettingsTab, operator: boolean): boolean {
  const operatorOnly = tab.requiresOperator === true;
  const open = !operatorOnly || operator;
  return open;
}

export function deriveEnabledTabs(
  tabs: readonly SettingsTab[],
  operator: boolean,
): readonly SettingsTab[] {
  const enabled = tabs.filter((tab) => canOpenTab(tab, operator));
  return enabled;
}

/** The asked-for tab when the viewer may open it, else the first one; an empty registry is a defect. */
export function resolveActiveTab(
  tabs: readonly SettingsTab[],
  requested: SettingsTabId | undefined,
): SettingsTab {
  const asked = tabs.find((tab) => tab.id === requested);
  const active = asked ?? tabs[0];
  if (active === undefined) {
    throw new Error("settings: no tab is enabled for this viewer");
  }
  return active;
}
