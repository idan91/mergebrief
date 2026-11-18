import { useMemo, useState, type Ref } from "react";

import { useMergedRef } from "@web/hooks/useMergedRef";
import { useMobileViewport } from "@web/hooks/useMobileViewport";
import type { ViewParam } from "../../../../model/comparison/compare-state";
import type { Brief } from "../../../../model/types";
import { reviewCommentsForChunk } from "../../../../model/utils/review-comments";
import type { BriefViewModel } from "../../../../model/utils/view-model";
import { ChunkPositionKinds } from "../ChunkIndicator/types";
import { useContentStarted } from "../ChunkIndicator/useContentStarted";
import { deriveChunkPosition } from "../ChunkIndicator/utils";
import type { ChunkGap } from "../ChunkStepper/utils";
import { useReadingPosition } from "../reading/reading-position";
import type { GithubHeadRef } from "../types";
import { findChunkById } from "./utils";

export interface LandscapeRowFacadeInput {
  brief: Brief;
  model: BriefViewModel;
  chunkIds: readonly string[];
  scope: ViewParam;
  openChunks: ReadonlySet<string>;
  controlsRef?: Ref<HTMLButtonElement> | undefined;
  jumpToChunk: (chunkId: string) => void;
}

/**
 * What the row shows from the one reading position: the indicator's
 * position, where Previous and Next step from, and the chunk the row names.
 * An open chunk menu holds its chunk, so a re-read under the sheet never
 * retargets its actions.
 */
export function useLandscapeRowFacade({
  brief,
  model,
  chunkIds,
  scope,
  openChunks,
  controlsRef,
  jumpToChunk,
}: LandscapeRowFacadeInput) {
  const { repo, sha } = brief.pr;
  const githubHead = useMemo<GithubHeadRef>(
    () => ({ repoSlug: repo, sha }),
    [repo, sha],
  );
  const activeChunkId = useReadingPosition(
    (state) => state.activeChunkId ?? undefined,
  );
  const betweenChunks = useReadingPosition((state) => state.betweenChunks);
  const activeBelowReader = useReadingPosition(
    (state) => state.activeBelowReader,
  );
  const mobile = useMobileViewport();
  const contentStart = useContentStarted(mobile);
  const position = deriveChunkPosition({
    chunkIds,
    activeChunkId,
    scope,
    pastContentStart: contentStart.started,
    betweenChunks,
  });
  const atChunk = position.kind === ChunkPositionKinds.CHUNK;
  const inGap = position.kind === ChunkPositionKinds.BETWEEN;
  const stepFromChunkId = atChunk || inGap ? activeChunkId : undefined;
  const gap: ChunkGap | undefined = inGap ? { activeBelowReader } : undefined;

  const [menuChunkId, setMenuChunkId] = useState<string>();
  const menuChunk = findChunkById(model.groups, menuChunkId);
  const rowChunk = atChunk
    ? findChunkById(model.groups, activeChunkId)
    : undefined;
  const chunk = menuChunk ?? rowChunk;
  const menuOpen = menuChunk !== undefined;
  const chunkOpen = chunk !== undefined && openChunks.has(chunk.id);
  const riskMeta =
    chunk === undefined ? undefined : model.riskMetaByChunk.get(chunk.id);
  const reviewCommentCount =
    chunk === undefined
      ? 0
      : reviewCommentsForChunk(brief.reviewComments ?? [], chunk).length;
  const titleState = chunk === undefined ? undefined : "hidden";

  const [controlsButton, setControlsButton] =
    useState<HTMLButtonElement | null>(null);
  const attachControls = useMergedRef(controlsRef, setControlsButton);
  // The menu button leaves with the chunk when the reader has moved off it.
  const closeMenu = () => {
    setMenuChunkId(undefined);
    if (rowChunk === undefined) {
      controlsButton?.focus();
    }
  };

  const stepToChunk = (chunkId: string) => {
    contentStart.markJumped();
    jumpToChunk(chunkId);
  };

  return {
    githubHead,
    position,
    stepFromChunkId,
    gap,
    chunk,
    chunkOpen,
    riskMeta,
    reviewCommentCount,
    titleState,
    menuOpen,
    openMenu: setMenuChunkId,
    closeMenu,
    attachControls,
    stepToChunk,
  };
}
