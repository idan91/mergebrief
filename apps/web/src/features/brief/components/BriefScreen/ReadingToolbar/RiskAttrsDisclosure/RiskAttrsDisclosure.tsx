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
import { RiskBadge } from "../../RiskBadge/RiskBadge";
import type { AttributeRail } from "../../../../utils/viewModel";
import styles from "./RiskAttrsDisclosure.module.scss";

export interface RiskAttrsDisclosureProps {
  rail: AttributeRail;
  jumpToGroup: (groupId: string) => void;
}

/**
 * The toolbar's Risk-attrs disclosure (BRIEF-134, replaces the in-flow
 * AttributeJumpRail): trigger `Risk attrs · N` opening an anchored panel of
 * attribute chips (ADR 0032 #11 — attribute-keyed, never group-ranked).
 * Clicking a chip CYCLES through its carrying groups in story order. A floor
 * firing puts an emphasis dot on the trigger — it NEVER auto-opens the
 * panel. Chunk targets (Concerns lens) ride on the rail entries but are not
 * wired here yet (PR 4).
 *
 * Positioned by floating-ui but rendered IN-TREE, not portaled: anchored to
 * a sticky bar, a body portal repositions via JS a frame behind every
 * scroll event and visibly stutters — in-tree the panel rides the bar
 * natively, so scroll tracking is disabled below. flip/shift still keep the
 * panel inside the viewport at open time.
 * Escape is claimed at CAPTURE phase (RiskChipDisclosure grammar): with the
 * panel open it dismisses the panel and must not leak to bubble-phase
 * shortcut listeners (focus-mode exit) — useDismiss stops propagation, but
 * only registers at capture when told to (`capture.escapeKey` defaults to
 * false in @floating-ui/react 0.27).
 */
export function RiskAttrsDisclosure({
  rail,
  jumpToGroup,
}: RiskAttrsDisclosureProps) {
  const [open, setOpen] = useState(false);
  const [cycle, setCycle] = useState<ReadonlyMap<string, number>>(new Map());
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

  return (
    <span className={styles["wrap"]}>
      <button
        aria-controls={open ? panelId : undefined}
        aria-expanded={open}
        className={styles["trigger"]}
        ref={refs.setReference}
        type="button"
        {...getReferenceProps()}
      >
        {rail.floorFired ? (
          <span
            aria-hidden="true"
            className={styles["dot"]}
            data-emphasis-dot=""
          />
        ) : null}
        <span className={styles["labelShort"]}>Attrs</span>
        <span className={styles["labelLong"]}>Risk attrs</span>
        <span aria-hidden="true" className={styles["sep"]}>
          ·
        </span>
        <b className={styles["count"]}>{rail.entries.length}</b>
        {rail.floorFired ? (
          <ScreenReaderOnly> — floor attribute fired</ScreenReaderOnly>
        ) : null}
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
            <div className={styles["chips"]} data-attribute-jump-rail="">
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
          </div>
        </FloatingFocusManager>
      ) : null}
    </span>
  );
}
