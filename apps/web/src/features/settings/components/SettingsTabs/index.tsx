import { useTranslation } from "react-i18next";

import { Icon } from "@web/components/Icon";
import { IconSizes } from "@web/components/Icon/types";
import { Tabs } from "@web/components/Tabs";
import { TabsVariants } from "@web/components/Tabs/types";
import type { SettingsTab, SettingsTabId } from "../../types";

export interface SettingsTabsProps {
  tabs: readonly SettingsTab[];
  active: SettingsTab;
  onSelect: (id: SettingsTabId) => void;
}

export function SettingsTabs({ tabs, active, onSelect }: SettingsTabsProps) {
  const { t } = useTranslation();
  const ActivePanel = active.Panel;

  if (tabs.length < 2) {
    return <ActivePanel active namedByRail={false} />;
  }

  function selectById(value: string) {
    const tab = tabs.find((entry) => entry.id === value);
    if (tab !== undefined) {
      onSelect(tab.id);
    }
  }

  return (
    <Tabs
      onValueChange={selectById}
      value={active.id}
      variant={TabsVariants.RAIL}
    >
      <Tabs.List label={t("shell.settingsSections")}>
        {tabs.map((tab) => (
          <Tabs.Tab key={tab.id} value={tab.id}>
            <Icon name={tab.icon} size={IconSizes.MD} />
            {t(tab.labelKey)}
          </Tabs.Tab>
        ))}
      </Tabs.List>
      {tabs.map((tab) => {
        const shown = tab.id === active.id;
        return (
          <Tabs.Panel key={tab.id} value={tab.id}>
            <tab.Panel active={shown} namedByRail />
          </Tabs.Panel>
        );
      })}
    </Tabs>
  );
}
