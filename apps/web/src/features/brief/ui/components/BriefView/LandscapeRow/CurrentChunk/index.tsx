import { resolveFileStatus } from "brief-core/chunk-layout";
import { formatDisplayPath } from "brief-core/hidden-chars";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Checkbox } from "@web/components/Checkbox";
import { Icon } from "@web/components/Icon";
import {
  IconNames,
  IconRotations,
  IconSizes,
} from "@web/components/Icon/types";
import { IconButton } from "@web/components/IconButton";
import { LocSign, LocSigns } from "@web/components/LocSign";
import { ScreenReaderOnly } from "@web/components/ScreenReaderOnly";
import {
  useChunkReviewComments,
  useReviewSession,
} from "@web/features/review/session";
import type { DiffLine } from "@web/utils/diffTokens/types";
import { useChunkWithRows } from "../../../../../model/file-rows/useFileRows";
import type { BriefChunk } from "../../../../../model/types";
import type { AttributeDisplayMeta } from "../../../../../model/utils/repo-config";
import { useReadingPosition } from "../../reading/reading-position";
import { ChunkActionsSheet } from "../../StoryView/ChunkCard/ChunkActionsSheet";
import { ChunkFacts } from "../../StoryView/ChunkCard/ChunkFacts";
import type { ChunkShare, GithubHeadRef } from "../../types";
import { resolveChunkGithubUrl } from "../../utils";
import styles from "./CurrentChunk.module.scss";

const NO_ROWS: DiffLine[] = [];

export interface CurrentChunkProps {
  /** Scrolls a chunk's header under the row. */
  jumpToChunk: (chunkId: string) => void;
  placeChunkUnderStack: (chunkId: string) => void;
  chunk: BriefChunk;
  open: boolean;
  toggleChunk: (chunkId: string) => void;
  markReviewed: (chunkId: string) => void;
  marksDisabled: boolean;
  /** The chunk menu is open; the row holds this chunk until it closes. */
  menuOpen: boolean;
  openMenu: (chunkId: string) => void;
  closeMenu: () => void;
  /** A revision load is pending: these controls go inert with the content. */
  pending: boolean;
  riskMeta: ReadonlyMap<string, AttributeDisplayMeta> | undefined;
  reviewCommentCount: number;
  shareChunk: ChunkShare | undefined;
  githubHead: GithubHeadRef;
}

/** The chunk the row is at: every control here acts on this one chunk. */
export function CurrentChunk({
  chunk: briefChunk,
  jumpToChunk,
  placeChunkUnderStack,
  open,
  toggleChunk,
  markReviewed,
  marksDisabled,
  menuOpen,
  openMenu,
  closeMenu,
  pending,
  riskMeta,
  reviewCommentCount,
  shareChunk,
  githubHead,
}: CurrentChunkProps) {
  const { t } = useTranslation();
  const chunk = useChunkWithRows(briefChunk);
  const requestFileComment = useReadingPosition(
    (state) => state.actions.requestFileComment,
  );
  const reviewed = useReviewSession((state) =>
    state.reviewedChunks.has(chunk.id),
  );
  const comments = useChunkReviewComments(chunk.id);
  const [menuButton, setMenuButton] = useState<HTMLButtonElement | null>(null);
  const displayFile = formatDisplayPath(chunk.file);
  const fileStatus = resolveFileStatus(chunk.diff ?? NO_ROWS);
  const githubUrl = resolveChunkGithubUrl(chunk, githubHead);
  const addressesComments = Boolean(chunk.addressesComments?.length);
  const foldRotation = open ? IconRotations.NONE : IconRotations.THREE_QUARTERS;
  const viewedFile = ` ${displayFile}`;
  // The composer sits under the chunk's own head, which may be far above by now.
  const requestComment = () => {
    jumpToChunk(chunk.id);
    requestFileComment(chunk.id);
  };
  const openChunkMenu = () => openMenu(chunk.id);
  const closeChunkMenu = () => {
    menuButton?.focus();
    closeMenu();
  };
  // A collapse from inside the chunk pulls the next chunk up with no scroll
  // event, so nothing would tell the row it now sits over a different chunk.
  const holdHeadThroughCollapse = () => {
    if (open) {
      placeChunkUnderStack(chunk.id);
    }
  };
  const foldChunk = () => {
    toggleChunk(chunk.id);
    holdHeadThroughCollapse();
  };
  const markChunkViewed = () => {
    markReviewed(chunk.id);
    holdHeadThroughCollapse();
  };

  return (
    <span className={styles["current"]} inert={pending || undefined}>
      <IconButton
        aria-expanded={open}
        aria-label={displayFile}
        className={styles["fold"]}
        label={displayFile}
        onClick={foldChunk}
      >
        <Icon
          name={IconNames.CARET_DOWN}
          rotation={foldRotation}
          size={IconSizes.SM}
        />
      </IconButton>
      <span className={styles["file"]}>
        <bdi dir="ltr">{displayFile}</bdi>
      </span>
      <span className={styles["counts"]}>
        <LocSign count={chunk.loc.added} sign={LocSigns.ADD} />{" "}
        <LocSign count={chunk.loc.deleted} sign={LocSigns.DEL} />
      </span>
      <span className={styles["viewed"]}>
        <Checkbox
          checked={reviewed}
          disabled={marksDisabled}
          onChange={markChunkViewed}
        >
          {t("brief.chunk.viewed")}
          <ScreenReaderOnly>{viewedFile}</ScreenReaderOnly>
        </Checkbox>
      </span>
      <IconButton
        aria-expanded={menuOpen}
        aria-haspopup="dialog"
        className={styles["menu"]}
        label={t("brief.mobile.chunkActions")}
        ref={setMenuButton}
        onClick={openChunkMenu}
      >
        <Icon name={IconNames.DOTS_THREE} size={IconSizes.LG} />
      </IconButton>
      {menuOpen ? (
        <ChunkActionsSheet
          chunkId={chunk.id}
          close={closeChunkMenu}
          displayFile={displayFile}
          facts={
            <ChunkFacts
              addressesComments={addressesComments}
              chunk={chunk}
              draftCount={comments.length}
              fileStatus={fileStatus}
              reviewCommentCount={reviewCommentCount}
              riskMeta={riskMeta}
            />
          }
          filePath={chunk.file}
          githubUrl={githubUrl}
          requestComment={requestComment}
          shareChunk={shareChunk}
        />
      ) : null}
    </span>
  );
}
