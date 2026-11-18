import { Link } from "@tanstack/react-router";
import type { Ref } from "react";
import { useTranslation } from "react-i18next";

import { Icon } from "@web/components/Icon";
import {
  IconNames,
  IconRotations,
  IconSizes,
} from "@web/components/Icon/types";
import { IconButton } from "@web/components/IconButton";
import type { ViewParam } from "../../../../model/comparison/compare-state";
import type { Brief } from "../../../../model/types";
import type { BriefViewModel } from "../../../../model/utils/view-model";
import { ChunkIndicator } from "../ChunkIndicator";
import { ChunkStepper } from "../ChunkStepper";
import type { ChunkShare } from "../types";
import { CurrentChunk } from "./CurrentChunk";
import { useLandscapeRowFacade } from "./useLandscapeRowFacade";
import styles from "./LandscapeRow.module.scss";

export interface LandscapeRowProps {
  brief: Brief;
  model: BriefViewModel;
  /** The chunks on the page, in reading order. */
  chunkIds: readonly string[];
  scope: ViewParam;
  openChunks: ReadonlySet<string>;
  toggleChunk: (chunkId: string) => void;
  markReviewed: (chunkId: string) => void;
  /** No session to save a mark into: Viewed renders, disabled. */
  marksDisabled: boolean;
  /** A revision load is pending: the chunk's controls go inert with the content. */
  pending: boolean;
  /** Scrolls a chunk's header under the row. */
  jumpToChunk: (chunkId: string) => void;
  /** Seats a chunk's head under the row, leaving it open or closed. */
  placeChunkUnderStack: (chunkId: string) => void;
  openBriefControls: () => void;
  controlsRef?: Ref<HTMLButtonElement>;
  /** Opens the Sidebar sheet; absent where the sheet is not on the page. */
  openSidebarSheet?: (() => void) | undefined;
  sidebarSheetOpen: boolean;
  indicatorRef?: Ref<HTMLButtonElement>;
  shareChunk?: ChunkShare | undefined;
}

/**
 * The one row a sideways phone keeps stuck: back, then the chunk whose head
 * has reached the row (its fold, file, counts, Viewed and menu, all from the
 * one active chunk id), then Previous, the indicator, Next and the controls.
 * Above the first chunk it names the PR instead, once the large title has
 * scrolled out.
 */
export function LandscapeRow({
  brief,
  model,
  chunkIds,
  scope,
  openChunks,
  toggleChunk,
  markReviewed,
  marksDisabled,
  pending,
  jumpToChunk,
  placeChunkUnderStack,
  openBriefControls,
  controlsRef,
  openSidebarSheet,
  sidebarSheetOpen,
  indicatorRef,
  shareChunk,
}: LandscapeRowProps) {
  const { t } = useTranslation();
  const row = useLandscapeRowFacade({
    brief,
    model,
    chunkIds,
    scope,
    openChunks,
    controlsRef,
    jumpToChunk,
  });
  const indicator = (
    <ChunkIndicator
      expanded={sidebarSheetOpen}
      openChunks={openSidebarSheet}
      position={row.position}
      ref={indicatorRef}
    />
  );

  return (
    <div
      aria-busy={pending || undefined}
      className={styles["row"]}
      data-landscape-row=""
      data-scroll-steering=""
      data-testid="landscape-row"
    >
      <Link
        aria-label={t("shell.backToBriefs")}
        className={styles["back"]}
        to="/"
      >
        <Icon
          name={IconNames.CARET_DOWN}
          rotation={IconRotations.QUARTER}
          size={IconSizes.LG}
        />
      </Link>
      <h1 className={styles["title"]} data-state={row.titleState}>
        {brief.pr.title}
      </h1>
      {row.chunk === undefined ? null : (
        <CurrentChunk
          chunk={row.chunk}
          jumpToChunk={jumpToChunk}
          githubHead={row.githubHead}
          markReviewed={markReviewed}
          marksDisabled={marksDisabled}
          menuOpen={row.menuOpen}
          open={row.chunkOpen}
          openMenu={row.openMenu}
          pending={pending}
          closeMenu={row.closeMenu}
          placeChunkUnderStack={placeChunkUnderStack}
          reviewCommentCount={row.reviewCommentCount}
          riskMeta={row.riskMeta}
          shareChunk={shareChunk}
          toggleChunk={toggleChunk}
        />
      )}
      <span className={styles["nav"]}>
        {scope === "changes" ? (
          indicator
        ) : (
          <ChunkStepper
            activeChunkId={row.stepFromChunkId}
            chunkIds={chunkIds}
            gap={row.gap}
            jumpToChunk={row.stepToChunk}
          >
            {indicator}
          </ChunkStepper>
        )}
        <IconButton
          aria-haspopup="dialog"
          className={styles["controls"]}
          label={t("brief.mobile.briefControls")}
          ref={row.attachControls}
          onClick={openBriefControls}
        >
          <Icon name={IconNames.SLIDERS_HORIZONTAL} size={IconSizes.LG} />
        </IconButton>
      </span>
    </div>
  );
}
