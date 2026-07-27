import { useId, useState } from "react";

import { ScreenReaderOnly } from "@web/components/ScreenReaderOnly/ScreenReaderOnly";
import { RiskBadge } from "../RiskBadge/RiskBadge";
import type { AttributeRail } from "../../../utils/viewModel";
import styles from "./AttributeJumpRail.module.scss";

export interface AttributeJumpRailProps {
  rail: AttributeRail;
  jumpToGroup: (groupId: string) => void;
}

/**
 * The attribute-keyed jump-rail (ADR 0032 #11): a separate collapsible row
 * sibling to the group TOC — fired attribute names with carrying-group
 * counts; clicking a chip CYCLES through its carrying groups in story
 * order. Deliberately attribute-keyed, never group-ranked ("high-risk
 * groups" would be the banned ordering verdict rebuilt as navigation).
 * Floor attributes are pinned first; de-emphasized firings are excluded
 * (buildAttributeRail). Collapsed by default unless a floor attribute
 * fired.
 */
export function AttributeJumpRail({
  rail,
  jumpToGroup,
}: AttributeJumpRailProps) {
  const [open, setOpen] = useState(rail.floorFired);
  const [cycle, setCycle] = useState<ReadonlyMap<string, number>>(new Map());
  const panelId = useId();
  if (rail.entries.length === 0) return null;

  return (
    <section className={styles["rail"]} data-attribute-jump-rail="">
      <button
        aria-controls={panelId}
        aria-expanded={open}
        className={styles["toggle"]}
        type="button"
        onClick={() => setOpen((value) => !value)}
      >
        Risk attributes
        <span className={styles["count"]}>{rail.entries.length}</span>
      </button>
      <div className={styles["chips"]} hidden={!open} id={panelId}>
        {rail.entries.map((entry) => {
          const position = cycle.get(entry.attr) ?? 0;
          const target = entry.groupIds[position % entry.groupIds.length];
          return (
            <button
              className={styles["chipButton"]}
              data-floor={entry.floor ? "" : undefined}
              key={entry.attr}
              type="button"
              onClick={() => {
                if (target === undefined) return;
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
                {entry.attr} ×{entry.groupIds.length}
                <ScreenReaderOnly>
                  {` — jump to carrying group ${(position % entry.groupIds.length) + 1} of ${entry.groupIds.length}, story order`}
                </ScreenReaderOnly>
              </RiskBadge>
            </button>
          );
        })}
      </div>
    </section>
  );
}
