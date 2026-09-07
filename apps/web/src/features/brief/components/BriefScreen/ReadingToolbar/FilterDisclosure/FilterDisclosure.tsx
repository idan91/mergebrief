import { useTranslation } from "react-i18next";
import {
  autoUpdate,
  flip,
  FloatingFocusManager,
  offset,
  shift,
  useClick,
  useDismiss,
  useFloating,
  useInteractions,
} from "@floating-ui/react";
import { useId, useState } from "react";

import { ScreenReaderOnly } from "@web/components/ScreenReaderOnly/ScreenReaderOnly";
import { ToolbarButton } from "@web/components/ToolbarButton/ToolbarButton";
import {
  ConversationFilterPanel,
  type ConversationFilterPanelProps,
} from "@web/features/conversation";
import { isFilterActive } from "@web/features/conversation/utils/filter";
import { filterTriggerSegments } from "./utils";
import styles from "./FilterDisclosure.module.scss";

export interface FilterDisclosureProps extends ConversationFilterPanelProps {
  /**
   * Threads the filter removes from the DIFF, an unannounced gap inline
   * reads as "nothing was said about this line". The critical trigger
   * number, and the live region's text.
   */
  hiddenInlineThreads: number;
}

/**
 * The ONLY filter surface. Rendered IN-TREE because a body portal stutters against
 * a sticky bar, so scroll tracking is off; Escape is claimed at CAPTURE and presses
 * inside the panel count as inside, so chip clicks keep it open. The `role="status"`
 * region lives HERE, always mounted, since one inserted populated is not read.
 */
export function FilterDisclosure({
  filter,
  verdicts,
  reviewers,
  hiddenInlineThreads,
  onChange,
}: FilterDisclosureProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const panelId = useId();

  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement: "bottom-start",
    // 14px from the trigger's bottom edge: the trigger sits inside the bar's
    // 8px inset (+1px border), leaving a ~5px visible gap below the bar.
    middleware: [offset(14), flip(), shift({ padding: 8 })],
    // No ancestorScroll: in-tree the panel moves with the sticky bar
    // natively; JS scroll-tracking would re-derive the same coords a frame
    // late and stutter.
    whileElementsMounted: (reference, floating, update) =>
      autoUpdate(reference, floating, update, { ancestorScroll: false }),
  });
  const click = useClick(context);
  const dismiss = useDismiss(context, { capture: { escapeKey: true } });
  const { getReferenceProps, getFloatingProps } = useInteractions([
    click,
    dismiss,
  ]);

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
      <ToolbarButton
        aria-controls={open ? panelId : undefined}
        aria-expanded={open}
        data-state={active ? "active" : "inactive"}
        data-testid="conversation-filter-trigger"
        ref={refs.setReference}
        {...getReferenceProps()}
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
      {open ? (
        /* Non-modal disclosure, not a dialog: focus stays on the trigger on
           open (initialFocus -1, the default steals it into the panel), Tab
           crosses into the in-tree panel naturally, and closing returns
           focus to the trigger. */
        <FloatingFocusManager
          context={context}
          initialFocus={-1}
          modal={false}
          order={["reference", "content"]}
        >
          <div
            className={styles["panel"]}
            id={panelId}
            ref={refs.setFloating}
            style={floatingStyles}
            {...getFloatingProps()}
          >
            <ConversationFilterPanel
              filter={filter}
              reviewers={reviewers}
              verdicts={verdicts}
              onChange={onChange}
            />
          </div>
        </FloatingFocusManager>
      ) : null}
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
