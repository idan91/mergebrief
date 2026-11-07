import { useTranslation } from "react-i18next";

import { Popover } from "@web/components/Popover";
import { ScreenReaderOnly } from "@web/components/ScreenReaderOnly";
import { ToolbarButton } from "@web/components/ToolbarButton";
import {
  ConversationFilterPanel,
  type ConversationFilterPanelProps,
} from "@web/features/conversation";
import { isFilterActive } from "@web/features/conversation/utils";
import { DISCLOSURE_OFFSET_PX } from "../consts";
import { filterTriggerSegments } from "./utils";
import styles from "./FilterDisclosure.module.scss";

export interface FilterDisclosureProps extends ConversationFilterPanelProps {
  /**
   * Threads the filter removes from the DIFF, an unannounced gap inline
   * reads as "nothing was said about this line". The critical trigger
   * number, and the live region's text.
   */
  hiddenInlineThreads: number;
  /** The panel rises as a sheet, for a trigger that already sits in one. */
  sheet?: boolean;
}

/**
 * The ONLY filter surface. Rendered IN-TREE because a body portal stutters against
 * a sticky bar; presses inside the panel count as inside, so chip clicks keep it
 * open. The `role="status"` region lives HERE, always mounted, since one
 * inserted populated is not read.
 */
export function FilterDisclosure({
  filter,
  verdicts,
  reviewers,
  hiddenInlineThreads,
  onChange,
  sheet,
}: FilterDisclosureProps) {
  const { t } = useTranslation();
  const active = isFilterActive(filter);

  // Nothing to slice and nothing sliced: a trigger promising a control it
  // does not have. (An active filter still renders even with emptied facets,
  // something must remain to unpress it.)
  if (verdicts.length === 0 && reviewers.length === 0 && !active) {
    return null;
  }

  const segments = filterTriggerSegments(t, filter, hiddenInlineThreads);

  return (
    <span className={styles["wrap"]}>
      <Popover offsetPx={DISCLOSURE_OFFSET_PX} portal={false}>
        <Popover.Trigger>
          <ToolbarButton
            data-state={active ? "active" : "inactive"}
            data-testid="conversation-filter-trigger"
          >
            {t("brief.toolbar.filterLabel")}
            {segments.map((segment, index) => (
              <span className={styles["segment"]} key={segment}>
                <span aria-hidden="true" className={styles["sep"]}>
                  ·
                </span>
                <span className={styles["count"]}>{segment}</span>
                {/* The hidden count (always last when present) is terse for a
                    screen reader, since "3 hidden" has no referent read alone. */}
                {index === segments.length - 1 && hiddenInlineThreads > 0 ? (
                  <ScreenReaderOnly>
                    {t("brief.toolbar.threadsInDiff", {
                      count: hiddenInlineThreads,
                    })}
                  </ScreenReaderOnly>
                ) : null}
              </span>
            ))}
          </ToolbarButton>
        </Popover.Trigger>
        <Popover.Content className={styles["panel"]} sheet={sheet}>
          <ConversationFilterPanel
            filter={filter}
            reviewers={reviewers}
            verdicts={verdicts}
            onChange={onChange}
          />
        </Popover.Content>
      </Popover>
      {/* Always mounted (and empty rather than absent when inactive), so the
          first "N threads hidden" lands as an UPDATE to a live region instead
          of the insertion screen readers skip. Visually the receipt is the
          trigger's own `N hidden` count. */}
      <p className="sr-only" role="status">
        {active && hiddenInlineThreads > 0
          ? t("brief.toolbar.threadsHiddenInDiff", {
              count: hiddenInlineThreads,
            })
          : ""}
      </p>
    </span>
  );
}
