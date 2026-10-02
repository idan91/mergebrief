import {
  useLayoutEffect,
  useRef,
  type FocusEvent,
  type KeyboardEvent,
} from "react";
import { useTranslation } from "react-i18next";

import { useReviewSession } from "@web/features/review/session";
import { useBodyScrollLock } from "@web/hooks/useBodyScrollLock";
import { useFocusTrap } from "@web/hooks/useFocusTrap";
import { isTypingTarget } from "@web/utils/typingTarget";
import {
  isAttributedGroupView,
  type BriefViewModel,
} from "../../../utils/viewModel";
import { useReadingPosition } from "../readingPosition";

type FocusReturn = "heading" | "tab";

export interface FocusPanelFacadeOptions {
  model: BriefViewModel;
  jumpToChunk: (chunkId: string) => void;
  open: boolean;
  sheet: boolean;
  setOpen: (open: boolean) => void;
}

/**
 * Focus contract: a pointer open, any open of the modal sheet and S reopening
 * from a focused tab land on the heading; a pointer close, a sheet close and
 * S hiding a panel that held focus return it to the tab, as does a crossing
 * of the breakpoint that left focus on the body, so focus never sits in an
 * inert panel or falls to the body.
 */
export function useFocusPanelFacade({
  model,
  jumpToChunk,
  open,
  sheet,
  setOpen,
}: FocusPanelFacadeOptions) {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const tabRef = useRef<HTMLButtonElement>(null);
  const focusReturn = useRef<FocusReturn | undefined>(undefined);
  const tabHeldFocus = useRef(false);
  const panelHeldFocus = useRef(false);
  const lastSheet = useRef(sheet);
  const activeGroupId = useReadingPosition((state) => state.activeGroupId);
  const activeChunkId = useReadingPosition((state) => state.activeChunkId);
  const sessionDominant = useReviewSession((state) =>
    activeGroupId === null ? undefined : state.dominants[activeGroupId],
  );
  const isReclassified = useReviewSession(
    (state) =>
      activeGroupId !== null && state.reclassifiedGroups.has(activeGroupId),
  );
  const trapFocus = useFocusTrap(panelRef);
  useBodyScrollLock(sheet && open);

  // Before paint: an inert panel sheds focus at the next rendering update.
  useLayoutEffect(() => {
    const target = focusReturn.current;
    focusReturn.current = undefined;
    const focusInHiddenPanel =
      !open && panelRef.current?.contains(document.activeElement) === true;
    const focusShed =
      !open &&
      panelHeldFocus.current &&
      document.activeElement === document.body;
    const sheetOpened = sheet && open;
    const reopenedFromTab = open && tabHeldFocus.current;
    tabHeldFocus.current = false;
    const layoutChanged = lastSheet.current !== sheet;
    lastSheet.current = sheet;
    const focusDropped =
      layoutChanged &&
      panelHeldFocus.current &&
      document.activeElement === document.body;
    if (target === "heading" || sheetOpened || reopenedFromTab) {
      headingRef.current?.focus({ preventScroll: true });
    } else if (
      target === "tab" ||
      focusInHiddenPanel ||
      focusShed ||
      focusDropped
    ) {
      tabRef.current?.focus();
    }
    if (layoutChanged) {
      panelHeldFocus.current = false;
    }
  }, [open, sheet]);

  const group = model.groups.find(
    (candidate) => candidate.id === activeGroupId,
  );
  const chunk =
    group?.chunks.find((candidate) => candidate.id === activeChunkId) ??
    group?.chunks[0];
  const modelDominant =
    group && isAttributedGroupView(group)
      ? group.group.dominantCategory
      : undefined;
  const dominant = sessionDominant ?? modelDominant;
  const groupNumber = group ? group.index + 1 : undefined;
  const tabLabel =
    groupNumber === undefined
      ? ""
      : t("brief.focusPanel.groupLabel", { index: groupNumber });

  // A blur with no target from a panel that just went inert is the browser
  // moving focus off it, not the reader leaving; keep the mark for the effect.
  const trackPanelBlur = (event: FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget;
    const fixup = next === null && event.currentTarget.inert;
    const stayed = next instanceof Node && event.currentTarget.contains(next);
    panelHeldFocus.current = fixup || stayed;
  };
  const trackPanelFocus = () => {
    panelHeldFocus.current = true;
  };
  const trackTabFocus = (held: boolean) => {
    tabHeldFocus.current = held;
  };
  const openFromPointer = () => {
    focusReturn.current = "heading";
    setOpen(true);
  };
  const closeFromPointer = () => {
    focusReturn.current = "tab";
    setOpen(false);
  };
  const jumpFromList = (chunkId: string) => {
    jumpToChunk(chunkId);
    if (sheet) {
      closeFromPointer();
    }
  };
  // The page shortcuts stand down inside a dialog, so the sheet owns its S.
  const handleSheetKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const modified =
      event.metaKey || event.ctrlKey || event.altKey || event.shiftKey;
    const hideKey =
      event.key.toLowerCase() === "s" &&
      !modified &&
      !isTypingTarget(event.target);
    if (event.key !== "Escape" && !hideKey) {
      trapFocus(event);
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    closeFromPointer();
  };

  return {
    t,
    panelRef,
    headingRef,
    tabRef,
    group,
    chunk,
    dominant,
    isReclassified,
    tabLabel,
    trackTabFocus,
    trackPanelFocus,
    trackPanelBlur,
    openFromPointer,
    closeFromPointer,
    jumpFromList,
    handleSheetKeyDown,
  };
}
