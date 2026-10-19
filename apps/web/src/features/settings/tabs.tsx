import { IconNames } from "@web/components/Icon/types";
import { TokenSettings } from "@web/features/tokens";
import { SettingsTabIds, type SettingsTab } from "./types";

function TokensPanel() {
  return <TokenSettings enabled />;
}

/** Every settings tab, in rail order. A new tab also takes a `SettingsTabIds` id and a catalog label. */
export const SETTINGS_TABS: readonly SettingsTab[] = [
  {
    id: SettingsTabIds.TOKENS,
    labelKey: "shell.settingsTabTokens",
    icon: IconNames.TERMINAL,
    Panel: TokensPanel,
  },
];
