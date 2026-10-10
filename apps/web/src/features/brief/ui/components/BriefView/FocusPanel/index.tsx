import { useId } from "react";

import { Icon } from "@web/components/Icon";
import { IconNames, IconSizes } from "@web/components/Icon/types";
import { IconButton, IconButtonSizes } from "@web/components/IconButton";
import { Kbd, KbdSizes } from "@web/components/Kbd";
import type { BriefViewModel } from "../../../../model/utils/view-model";
import { PanelContent } from "./PanelContent";
import { useFocusPanelFacade } from "./useFocusPanelFacade";
import styles from "./FocusPanel.module.scss";

export interface FocusPanelProps {
  model: BriefViewModel;
  jumpToChunk: (chunkId: string) => void;
  open: boolean;
  /** Below the tablet breakpoint: a modal bottom sheet, not a side panel. */
  sheet: boolean;
  setOpen: (open: boolean) => void;
}

/**
 * On desktop a non-modal complementary panel beside a readable, usable diff;
 * below the tablet breakpoint a modal sheet over a scrim.
 */
export function FocusPanel(props: FocusPanelProps) {
  const { model, open, sheet } = props;
  const panelId = useId();
  const facade = useFocusPanelFacade(props);
  const { t, group } = facade;
  if (!group) {
    return null;
  }

  const state = open ? "open" : "closed";
  const variant = sheet ? "sheet" : "side";
  const role = sheet ? "dialog" : "complementary";
  const sheetOpen = sheet && open;
  const content = (
    <PanelContent
      chunk={facade.chunk}
      dominant={facade.dominant}
      group={group}
      headingRef={facade.headingRef}
      hide={facade.closeFromPointer}
      isReclassified={facade.isReclassified}
      jumpToChunk={facade.jumpFromList}
      model={model}
    />
  );

  return (
    <>
      {sheetOpen ? (
        // oxlint-disable-next-line house/no-raw-button -- full-viewport scrim: a tap target with no chrome
        <button
          aria-label={t("brief.focusPanel.hide")}
          className={styles["scrim"]}
          type="button"
          onClick={facade.closeFromPointer}
        />
      ) : null}
      {/* One element for both layouts, so crossing the breakpoint never remounts the content under focus. The keydown is the sheet's Tab trap and Escape; focus and blur only track where focus sits. */}
      {/* oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- the role is dialog or complementary, set from the layout */}
      <div
        aria-label={t("brief.focusPanel.ariaLabel")}
        aria-modal={sheet || undefined}
        className={styles["panel"]}
        data-state={state}
        data-testid="focus-panel"
        data-variant={variant}
        id={panelId}
        inert={!open || undefined}
        ref={facade.panelRef}
        role={role}
        tabIndex={sheet ? -1 : undefined}
        onBlur={facade.trackPanelBlur}
        onFocus={facade.trackPanelFocus}
        onKeyDown={sheet ? facade.handleSheetKeyDown : undefined}
      >
        {content}
      </div>
      {open ? null : (
        <IconButton
          aria-controls={panelId}
          aria-expanded={false}
          aria-haspopup={sheet ? "dialog" : undefined}
          autoWidth
          className={styles["tab"]}
          data-layout={variant}
          data-testid="focus-panel-tab"
          label={t("brief.focusPanel.show", { label: facade.tabLabel })}
          ref={facade.tabRef}
          size={IconButtonSizes.MD}
          onBlur={() => facade.trackTabFocus(false)}
          onClick={facade.openFromPointer}
          onFocus={() => facade.trackTabFocus(true)}
        >
          <Icon name={IconNames.LIST_BULLETS} size={IconSizes.MD} />
          <span>{facade.tabLabel}</span>
          <Kbd size={KbdSizes.SM}>S</Kbd>
        </IconButton>
      )}
    </>
  );
}
