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
import {
  ConversationFilterPanel,
  type ConversationFilterPanelProps,
} from "@web/features/conversation";
import { isFilterActive } from "@web/features/conversation/utils/filter";
import { filterTriggerSegments } from "./utils";
import styles from "./FilterDisclosure.module.scss";

export interface FilterDisclosureProps extends ConversationFilterPanelProps {
  /**
   * Threads the filter removes from the DIFF (BRIEF-99 decision 9) — an
   * unannounced gap inline reads as "nothing was said about this line".
   * The load-bearing trigger number, and the live region's text.
   */
  hiddenInlineThreads: number;
}

/**
 * The toolbar's Filter disclosure (BRIEF-134, re-homes the BRIEF-99 bar):
 * the ONLY filter surface. Inactive = plain `Filter`; active = the receipt
 * (`Filter · N verdicts · N reviewers · N hidden`). Opens the full BRIEF-99
 * panel anchored beneath the trigger — RiskChipDisclosure grammar: Escape
 * consumed at capture and focus returned to the trigger, outside pointerdown
 * closes, chip clicks keep it open.
 *
 * Positioned by floating-ui but rendered IN-TREE, not portaled: anchored to
 * a sticky bar, a body portal repositions via JS a frame behind every
 * scroll event and visibly stutters — in-tree the panel rides the bar
 * natively, so scroll tracking is disabled below. flip/shift still keep the
 * panel inside the viewport at open time.
 * useDismiss claims Escape at CAPTURE phase (`capture.escapeKey` — the 0.27
 * default is bubble) so dismissal never leaks to bubble-phase shortcut
 * listeners; presses inside the panel count as inside, so chip clicks keep
 * it open.
 *
 * The `role="status"` region lives HERE, ALWAYS mounted while the disclosure
 * renders — inside the panel it would unmount on close, and a live region
 * inserted already-populated is exactly the announcement screen readers
 * skip. Renders nothing only when no family exists AND nothing is filtered
 * (an active filter must keep a control that can undo it).
 */
export function FilterDisclosure({
  filter,
  verdicts,
  reviewers,
  hiddenInlineThreads,
  onChange,
}: FilterDisclosureProps) {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement: "bottom-start",
    // 14px from the trigger's bottom edge: the trigger sits inside the bar's
    // 8px inset (+1px border), leaving a ~5px visible gap below the bar —
    // the same clearance the CSS-anchored panel rendered.
    middleware: [offset(14), flip(), shift({ padding: 8 })],
    // No ancestorScroll: in-tree the panel moves with the sticky bar
    // natively; JS scroll-tracking would only re-derive the same coords a
    // frame late (the portal-era stutter).
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
  // does not have. (An active filter still renders even with emptied facets
  // — something must remain to unpress it.)
  if (verdicts.length === 0 && reviewers.length === 0 && !active) {
    return null;
  }

  const segments = filterTriggerSegments(filter, hiddenInlineThreads);

  return (
    <span className={styles["wrap"]}>
      <button
        aria-controls={open ? panelId : undefined}
        aria-expanded={open}
        className={styles["trigger"]}
        data-state={active ? "active" : "inactive"}
        data-testid="conversation-filter-trigger"
        ref={refs.setReference}
        type="button"
        {...getReferenceProps()}
      >
        Filter
        {segments.map((segment, index) => (
          <span className={styles["segment"]} key={segment}>
            <span aria-hidden="true" className={styles["sep"]}>
              ·
            </span>
            <span className={styles["count"]}>{segment}</span>
            {/* The hidden count (always last when present) is terse for a
                screen reader — "3 hidden" has no referent read alone. */}
            {index === segments.length - 1 && hiddenInlineThreads > 0 ? (
              <ScreenReaderOnly>
                {hiddenInlineThreads === 1
                  ? " thread in the diff"
                  : " threads in the diff"}
              </ScreenReaderOnly>
            ) : null}
          </span>
        ))}
      </button>
      {open ? (
        /* Non-modal disclosure, not a dialog: focus stays on the trigger on
           open (initialFocus -1 — the default steals it into the panel), Tab
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
          ? `${hiddenInlineThreads} thread${
              hiddenInlineThreads === 1 ? "" : "s"
            } hidden in the diff`
          : ""}
      </p>
    </span>
  );
}
