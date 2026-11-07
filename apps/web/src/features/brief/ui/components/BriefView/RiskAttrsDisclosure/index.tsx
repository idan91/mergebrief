import { useTranslation } from "react-i18next";

import { Popover } from "@web/components/Popover";
import { ScreenReaderOnly } from "@web/components/ScreenReaderOnly";
import { ToolbarButton } from "@web/components/ToolbarButton";
import type { RiskAttrCycle } from "../hooks/useRiskAttrCycle";
import { RiskBadge } from "../RiskBadge";
import type { AttributeDisplayMeta } from "../../../../model/utils/repo-config";
import type { AttributeRail } from "../../../../model/utils/view-model";
import { DISCLOSURE_OFFSET_PX } from "../consts";
import styles from "./RiskAttrsDisclosure.module.scss";

export interface RiskAttrsDisclosureProps {
  rail: AttributeRail;
  /** A chip click cycles through the attribute's carrying groups. */
  jumpToGroup: (groupId: string) => void;
  cycle: RiskAttrCycle;
  /** The panel rises as a sheet, for a trigger that already sits in one. */
  sheet?: boolean;
}

/**
 * Trigger `Risk attributes · N` opening a panel of attribute chips, keyed by attribute
 * and never group-ranked; a chip CYCLES its carrying targets in story order, and a
 * floor firing dots the trigger without auto-opening. Rendered IN-TREE because a
 * body portal stutters against a sticky bar.
 */
export function RiskAttrsDisclosure({
  rail,
  jumpToGroup,
  cycle,
  sheet,
}: RiskAttrsDisclosureProps) {
  const { t } = useTranslation();
  const chips = rail.entries.map((entry) => {
    const ids = entry.groupIds;
    const position = cycle.positions.get(entry.attr) ?? 0;
    const target = ids[position % ids.length];
    const countSuffix = ` ×${String(ids.length)}`;
    const jumpPosition = (position % ids.length) + 1;
    const jumpLabel = t("brief.toolbar.srJumpToCarryingGroup", {
      position: jumpPosition,
      total: ids.length,
    });
    const badgeMeta: AttributeDisplayMeta | undefined =
      entry.source === "repo-policy"
        ? { source: "repo-policy", deEmphasized: false }
        : undefined;
    return { entry, target, countSuffix, jumpLabel, badgeMeta };
  });

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
            {t("brief.toolbar.attrsLong")}
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
        <Popover.Content className={styles["panel"]} sheet={sheet}>
          <div className={styles["chips"]} data-attribute-jump-rail="">
            {chips.map(
              ({ entry, target, countSuffix, jumpLabel, badgeMeta }) => (
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
                    cycle.advance(entry.attr);
                  }}
                >
                  <RiskBadge attribute={entry.attr} meta={badgeMeta}>
                    {countSuffix}
                    <ScreenReaderOnly>{jumpLabel}</ScreenReaderOnly>
                  </RiskBadge>
                </button>
              ),
            )}
          </div>
        </Popover.Content>
      </Popover>
    </span>
  );
}
