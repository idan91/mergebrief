import { IconNames } from "@web/components/Icon/types";
import { TokenSettings } from "@web/features/tokens";
import { InstancePanel } from "./components/InstancePanel";
import {
  SettingsTabIds,
  type SettingsPanelProps,
  type SettingsTab,
} from "./types";

function TokensPanel({ namedByRail }: SettingsPanelProps) {
  return <TokenSettings enabled namedByRail={namedByRail} />;
}

/** Every settings tab, in rail order. A new tab also takes a `SettingsTabIds` id and a catalog label. */
export const SETTINGS_TABS: readonly SettingsTab[] = [
  {
    id: SettingsTabIds.TOKENS,
    labelKey: "shell.settingsTabTokens",
    icon: IconNames.TERMINAL,
    Panel: TokensPanel,
  },
  {
    id: SettingsTabIds.INSTANCE,
    labelKey: "shell.settingsTabInstance",
    icon: IconNames.SLIDERS_HORIZONTAL,
    requiresOperator: true,
    Panel: InstancePanel,
  },
];
