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
import { RiskBadge } from "../../RiskBadge/RiskBadge";
import type { AttributeRail } from "../../../../utils/viewModel";
import styles from "./RiskAttrsDisclosure.module.scss";

export interface RiskAttrsDisclosureProps {
  rail: AttributeRail;
  /** A chip click cycles through the attribute's carrying groups. */
  jumpToGroup: (groupId: string) => void;
}

/**
 * Trigger `Risk attrs · N` opening an anchored panel of attribute chips —
 * attribute-keyed, never group-ranked. Clicking a chip CYCLES through its
 * carrying targets in story order. A floor firing puts an emphasis dot on
 * the trigger — it NEVER auto-opens the panel.
 *
 * Positioned by floating-ui but rendered IN-TREE, not portaled: anchored to
 * a sticky bar, a body portal repositions via JS a frame behind every scroll
 * event and visibly stutters — in-tree the panel rides the bar natively, so
 * scroll tracking is disabled below. flip/shift still keep the panel inside
 * the viewport at open time. Escape is claimed at CAPTURE phase so
 * dismissing the panel cannot leak to bubble-phase shortcut listeners;
 * useDismiss only registers at capture when told to.
 */
export function RiskAttrsDisclosure({
  rail,
  jumpToGroup,
}: RiskAttrsDisclosureProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [cycle, setCycle] = useState<ReadonlyMap<string, number>>(new Map());
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

  return (
    <span className={styles["wrap"]}>
      <ToolbarButton
        aria-controls={open ? panelId : undefined}
        aria-expanded={open}
        ref={refs.setReference}
        {...getReferenceProps()}
      >
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
          <ScreenReaderOnly>{t("brief.toolbar.srFloorFired")}</ScreenReaderOnly>
        ) : null}
      </ToolbarButton>
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
            <div className={styles["chips"]} data-attribute-jump-rail="">
              {rail.entries.map((entry) => {
                const ids = entry.groupIds;
                const position = cycle.get(entry.attr) ?? 0;
                const target = ids[position % ids.length];
                return (
                  // eslint-disable-next-line no-restricted-syntax -- reset wrapper making the inner chip interactive: component chrome would double it
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
                      {entry.attr} ×{ids.length}
                      <ScreenReaderOnly>
                        {` — jump to carrying group ${(position % ids.length) + 1} of ${ids.length}, story order`}
                      </ScreenReaderOnly>
                    </RiskBadge>
                  </button>
                );
              })}
            </div>
          </div>
        </FloatingFocusManager>
      ) : null}
    </span>
  );
}
