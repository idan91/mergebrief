import { useId, useLayoutEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

import { Icon } from "@web/components/Icon";
import { IconNames, IconSizes } from "@web/components/Icon/types";
import { IconButton, IconButtonSizes } from "@web/components/IconButton";
import { Kbd, KbdSizes } from "@web/components/Kbd";
import {
  isAttributedGroupView,
  type BriefViewModel,
} from "../../../utils/viewModel";
import { useReadingPosition } from "../readingPosition";
import { ChunkList } from "./ChunkList";
import { FileFacts } from "./FileFacts";
import { GroupFacts } from "./GroupFacts";
import styles from "./FocusPanel.module.scss";

export interface FocusPanelProps {
  model: BriefViewModel;
  jumpToChunk: (chunkId: string) => void;
  open: boolean;
  setOpen: (open: boolean) => void;
}

type FocusReturn = "heading" | "tab";

/**
 * Non-modal: the diff beside it stays readable and interactive. A pointer
 * open moves focus to the heading and a pointer close returns it to the tab.
 * S moves focus only out of a panel it hides, so focus never lands in inert,
 * and into one it reopens from the tab, which unmounts under it.
 */
export function FocusPanel({
  model,
  jumpToChunk,
  open,
  setOpen,
}: FocusPanelProps) {
  const { t } = useTranslation();
  const panelId = useId();
  const panelRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const tabRef = useRef<HTMLButtonElement>(null);
  const focusReturn = useRef<FocusReturn | undefined>(undefined);
  const tabHeldFocus = useRef(false);
  const activeGroupId = useReadingPosition((state) => state.activeGroupId);
  const activeChunkId = useReadingPosition((state) => state.activeChunkId);

  // Before paint: an inert panel sheds focus at the next rendering update.
  useLayoutEffect(() => {
    const target = focusReturn.current;
    focusReturn.current = undefined;
    const focusInHiddenPanel =
      !open && panelRef.current?.contains(document.activeElement) === true;
    const reopenedFromTab = open && tabHeldFocus.current;
    tabHeldFocus.current = false;
    if (target === "heading" || reopenedFromTab) {
      headingRef.current?.focus({ preventScroll: true });
    } else if (target === "tab" || focusInHiddenPanel) {
      tabRef.current?.focus();
    }
  }, [open]);

  const group = model.groups.find(
    (candidate) => candidate.id === activeGroupId,
  );
  if (!group) {
    return null;
  }

  const chunk =
    group.chunks.find((candidate) => candidate.id === activeChunkId) ??
    group.chunks[0];
  const groupNumber = group.index + 1;
  const meta = t("brief.focusIndicator.groupOf", {
    index: groupNumber,
    total: model.groups.length,
  });
  const tabLabel = t("brief.focusPanel.groupLabel", { index: groupNumber });
  const flagCount = model.flagsByGroup.get(group.id)?.length ?? 0;
  const chunkRiskMeta = chunk ? model.riskMetaByChunk.get(chunk.id) : undefined;
  const showRisks = isAttributedGroupView(group);

  const openFromPointer = () => {
    focusReturn.current = "heading";
    setOpen(true);
  };
  const closeFromPointer = () => {
    focusReturn.current = "tab";
    setOpen(false);
  };

  return (
    <>
      <aside
        aria-label={t("brief.focusPanel.ariaLabel")}
        className={styles["panel"]}
        data-state={open ? "open" : "closed"}
        data-testid="focus-panel"
        id={panelId}
        inert={!open || undefined}
        ref={panelRef}
      >
        <div className={styles["head"]}>
          <span className={styles["meta"]}>{meta}</span>
          <IconButton
            label={t("brief.focusPanel.hide")}
            onClick={closeFromPointer}
          >
            <Icon name={IconNames.X} size={IconSizes.MD} />
          </IconButton>
        </div>
        <div
          aria-label={t("brief.focusPanel.detailsLabel")}
          className={styles["body"]}
          role="region"
          tabIndex={0}
        >
          <GroupFacts
            flagCount={flagCount}
            group={group}
            headingRef={headingRef}
          />
          {chunk ? (
            <FileFacts
              chunk={chunk}
              riskMeta={chunkRiskMeta}
              showRisks={showRisks}
            />
          ) : null}
          <ChunkList
            activeChunkId={activeChunkId}
            chunks={group.chunks}
            jumpToChunk={jumpToChunk}
          />
        </div>
      </aside>
      {open ? null : (
        <IconButton
          aria-controls={panelId}
          aria-expanded={false}
          autoWidth
          className={styles["tab"]}
          data-testid="focus-panel-tab"
          label={t("brief.focusPanel.show", { label: tabLabel })}
          ref={tabRef}
          size={IconButtonSizes.MD}
          onBlur={() => {
            tabHeldFocus.current = false;
          }}
          onClick={openFromPointer}
          onFocus={() => {
            tabHeldFocus.current = true;
          }}
        >
          <Icon name={IconNames.LIST_BULLETS} size={IconSizes.MD} />
          <span>{tabLabel}</span>
          <Kbd size={KbdSizes.SM}>S</Kbd>
        </IconButton>
      )}
    </>
  );
}
