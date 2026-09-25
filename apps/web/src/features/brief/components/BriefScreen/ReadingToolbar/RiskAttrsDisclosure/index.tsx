import { useTranslation } from "react-i18next";
import { useState } from "react";

import { Popover } from "@web/components/Popover";
import { ScreenReaderOnly } from "@web/components/ScreenReaderOnly";
import { ToolbarButton } from "@web/components/ToolbarButton";
import { RiskBadge } from "../../RiskBadge";
import type { AttributeRail } from "../../../../utils/viewModel";
import { DISCLOSURE_OFFSET_PX } from "../consts";
import styles from "./RiskAttrsDisclosure.module.scss";

export interface RiskAttrsDisclosureProps {
  rail: AttributeRail;
  /** A chip click cycles through the attribute's carrying groups. */
  jumpToGroup: (groupId: string) => void;
}

/**
 * Trigger `Risk attrs · N` opening a panel of attribute chips, keyed by attribute
 * and never group-ranked; a chip CYCLES its carrying targets in story order, and a
 * floor firing dots the trigger without auto-opening. Rendered IN-TREE because a
 * body portal stutters against a sticky bar.
 */
export function RiskAttrsDisclosure({
  rail,
  jumpToGroup,
}: RiskAttrsDisclosureProps) {
  const { t } = useTranslation();
  const [cycle, setCycle] = useState<ReadonlyMap<string, number>>(new Map());

  return (
    <span className={styles["wrap"]}>
      <Popover offsetPx={DISCLOSURE_OFFSET_PX} portal={false}>
        <Popover.Trigger>
          <ToolbarButton>
            {rail.floorFired ? (
              <span
                aria-hidden="true"
                className={styles["dot"]}
                data-emphasis-dot=""
              />
            ) : null}
            <span className={styles["labelShort"]}>
              {t("brief.toolbar.attrsShort")}
            </span>
            <span className={styles["labelLong"]}>
              {t("brief.toolbar.attrsLong")}
            </span>
            <span aria-hidden="true" className={styles["sep"]}>
              ·
            </span>
            <b className={styles["count"]}>{rail.entries.length}</b>
            {rail.floorFired ? (
              <ScreenReaderOnly>
                {t("brief.toolbar.srFloorFired")}
              </ScreenReaderOnly>
            ) : null}
          </ToolbarButton>
        </Popover.Trigger>
        <Popover.Content className={styles["panel"]}>
          <div className={styles["chips"]} data-attribute-jump-rail="">
            {rail.entries.map((entry) => {
              const ids = entry.groupIds;
              const position = cycle.get(entry.attr) ?? 0;
              const target = ids[position % ids.length];
              return (
                // oxlint-disable-next-line house/no-raw-button -- reset wrapper making the inner chip interactive: component chrome would double it
                <button
                  className={styles["chipButton"]}
                  data-floor={entry.floor ? "" : undefined}
                  key={entry.attr}
                  type="button"
                  onClick={() => {
                    if (target === undefined) {
                      return;
                    }
                    jumpToGroup(target);
                    setCycle((previous) => {
                      const next = new Map(previous);
                      next.set(entry.attr, position + 1);
                      return next;
                    });
                  }}
                >
                  <RiskBadge
                    meta={
                      entry.source === "repo-policy"
                        ? { source: "repo-policy", deEmphasized: false }
                        : undefined
                    }
                  >
                    {entry.attr} ×{ids.length}
                    <ScreenReaderOnly>
                      {t("brief.toolbar.srJumpToCarryingGroup", {
                        position: (position % ids.length) + 1,
                        total: ids.length,
                      })}
                    </ScreenReaderOnly>
                  </RiskBadge>
                </button>
              );
            })}
          </div>
        </Popover.Content>
      </Popover>
    </span>
  );
}
