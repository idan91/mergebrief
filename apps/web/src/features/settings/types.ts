import type { TranslationKey } from "i18n";
import type { ComponentType } from "react";
import type { ValueOf } from "types/utils";

import type { IconName } from "@web/components/Icon/types";

/** The settings tabs the page can show; `?tab=` names one. */
export const SettingsTabIds = {
  TOKENS: "tokens",
  INSTANCE: "instance",
} as const;
export type SettingsTabId = ValueOf<typeof SettingsTabIds>;

/** What every settings panel is told; a hidden panel stays mounted. */
export interface SettingsPanelProps {
  /** Its tab is the one shown; a panel that polls pauses while hidden. */
  readonly active: boolean;
}

/** One tab in the registry: what the rail shows and the panel it opens. */
export interface SettingsTab {
  readonly id: SettingsTabId;
  readonly labelKey: TranslationKey;
  readonly icon: IconName;
  /** Only an Operator of the Instance sees the tab. */
  readonly requiresOperator?: boolean;
  readonly Panel: ComponentType<SettingsPanelProps>;
}

/** The settings route's search: the tab the address asks for, when it names a known one. */
export interface SettingsSearch {
  readonly tab?: SettingsTabId;
}
