import { useId } from "react";
import { useTranslation } from "react-i18next";

import { Icon } from "@web/components/Icon";
import { IconNames, IconSizes } from "@web/components/Icon/types";
import { Popover } from "@web/components/Popover";
import { ToolbarButton } from "@web/components/ToolbarButton";
import { AlarmMark } from "../AlarmMark";
import { INTENT_LEGEND_ROWS } from "./consts";
import styles from "./IntentLegend.module.scss";
import { LegendRow } from "./LegendRow";

export function IntentLegend() {
  const { t } = useTranslation();
  const titleId = useId();
  const markName = t("brief.intent.legendMarkName");
  const rows = INTENT_LEGEND_ROWS.map((row) => (
    <LegendRow key={row.labelKey} row={row} />
  ));

  return (
    <span className={styles["wrap"]}>
      <Popover placement="bottom-end" portal={false}>
        <Popover.Trigger>
          <ToolbarButton className={styles["trigger"]}>
            <Icon name={IconNames.QUESTION} size={IconSizes.MD} />
            {t("brief.intent.legendTrigger")}
          </ToolbarButton>
        </Popover.Trigger>
        <Popover.Content className={styles["panel"]}>
          <section aria-labelledby={titleId}>
            <h2 className={styles["title"]} id={titleId}>
              {t("brief.intent.legendTitle")}
            </h2>
            <p className={styles["intro"]}>{t("brief.intent.legendIntro")}</p>
            <dl className={styles["rows"]}>{rows}</dl>
            <p className={styles["markNote"]}>
              <AlarmMark label={markName} />
              <span>{t("brief.intent.legendMarkNote")}</span>
            </p>
          </section>
        </Popover.Content>
      </Popover>
    </span>
  );
}
