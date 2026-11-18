import type { Ref } from "react";
import { useTranslation } from "react-i18next";

import { Icon } from "@web/components/Icon";
import { IconNames, IconSizes } from "@web/components/Icon/types";
import { IconButton } from "@web/components/IconButton";
import { useMobileViewport } from "@web/hooks/useMobileViewport";
import type { ViewParam } from "../../../../model/comparison/compare-state";
import { ChunkIndicator } from "../ChunkIndicator";
import { ChunkPositionKinds } from "../ChunkIndicator/types";
import { useContentStarted } from "../ChunkIndicator/useContentStarted";
import { deriveChunkPosition } from "../ChunkIndicator/utils";
import { ChunkStepper } from "../ChunkStepper";
import { useReadingPosition } from "../reading/reading-position";
import styles from "./PhoneBar.module.scss";

export interface PhoneBarProps {
  /** The chunks on the page, in reading order. */
  chunkIds: readonly string[];
  scope: ViewParam;
  /** Scrolls a chunk's header under the sticky stack. */
  jumpToChunk: (chunkId: string) => void;
  openBriefControls: () => void;
  /** The Brief controls trigger, so the sheet can hand focus back. */
  controlsRef?: Ref<HTMLButtonElement> | undefined;
  /** Opens the Sidebar sheet; absent where the sheet is not on the page. */
  openChunks?: (() => void) | undefined;
  chunksExpanded: boolean;
  /** The Sidebar sheet's trigger, so the sheet can hand focus back. */
  indicatorRef?: Ref<HTMLButtonElement> | undefined;
}

/** The phone's bottom bar: Brief controls, where the reader is, and one chunk either way. */
export function PhoneBar({
  chunkIds,
  scope,
  jumpToChunk,
  openBriefControls,
  controlsRef,
  openChunks,
  chunksExpanded,
  indicatorRef,
}: PhoneBarProps) {
  const { t } = useTranslation();
  const activeChunkId = useReadingPosition(
    (state) => state.activeChunkId ?? undefined,
  );
  const mobile = useMobileViewport();
  const contentStart = useContentStarted(mobile);
  const position = deriveChunkPosition({
    chunkIds,
    activeChunkId,
    scope,
    pastContentStart: contentStart.started,
  });
  const steppedFrom =
    position.kind === ChunkPositionKinds.CHUNK ? activeChunkId : undefined;
  const stepToChunk = (chunkId: string) => {
    contentStart.markJumped();
    jumpToChunk(chunkId);
  };

  return (
    <div
      className={styles["bar"]}
      data-scroll-steering=""
      data-testid="phone-bar"
    >
      <IconButton
        aria-haspopup="dialog"
        className={styles["controls"]}
        label={t("brief.mobile.briefControls")}
        ref={controlsRef}
        onClick={openBriefControls}
      >
        <Icon name={IconNames.SLIDERS_HORIZONTAL} size={IconSizes.LG} />
      </IconButton>
      <ChunkIndicator
        expanded={chunksExpanded}
        openChunks={openChunks}
        position={position}
        ref={indicatorRef}
      />
      {scope === "changes" ? null : (
        <ChunkStepper
          activeChunkId={steppedFrom}
          chunkIds={chunkIds}
          jumpToChunk={stepToChunk}
        />
      )}
    </div>
  );
}
