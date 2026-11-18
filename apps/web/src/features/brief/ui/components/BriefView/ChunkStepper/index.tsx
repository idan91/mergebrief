import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { Icon } from "@web/components/Icon";
import {
  IconNames,
  IconRotations,
  IconSizes,
} from "@web/components/Icon/types";
import { IconButton } from "@web/components/IconButton";
import {
  resolveChunkStepTargets,
  resolveGapStepTargets,
  type ChunkGap,
} from "./utils";
import styles from "./ChunkStepper.module.scss";

export interface ChunkStepperProps {
  /** The chunks on the page, in reading order. */
  chunkIds: readonly string[];
  /** The chunk the reader is at; absent from the Overview. */
  activeChunkId: string | undefined;
  /** The reader is between chunks beside the active one; steps land on the gap's neighbours. */
  gap?: ChunkGap | undefined;
  jumpToChunk: (chunkId: string) => void;
  /** Sits between Previous and Next: the sideways row's indicator. */
  children?: ReactNode;
}

/** Previous and Next chunk, 44px each, stepping the reading order one chunk at a time. */
export function ChunkStepper({
  chunkIds,
  activeChunkId,
  gap,
  jumpToChunk,
  children,
}: ChunkStepperProps) {
  const { t } = useTranslation();
  const targets =
    gap === undefined
      ? resolveChunkStepTargets(chunkIds, activeChunkId)
      : resolveGapStepTargets(chunkIds, activeChunkId, gap);

  const step = (chunkId: string | undefined) => {
    if (chunkId !== undefined) {
      jumpToChunk(chunkId);
    }
  };

  return (
    <span className={styles["stepper"]}>
      <IconButton
        className={styles["step"]}
        disabled={targets.previous === undefined}
        label={t("brief.chunkFooter.previousChunk")}
        onClick={() => step(targets.previous)}
      >
        <Icon
          name={IconNames.CARET_DOWN}
          rotation={IconRotations.QUARTER}
          size={IconSizes.LG}
        />
      </IconButton>
      {children}
      <IconButton
        className={styles["step"]}
        disabled={targets.next === undefined}
        label={t("brief.chunkFooter.nextChunk")}
        onClick={() => step(targets.next)}
      >
        <Icon
          name={IconNames.CARET_DOWN}
          rotation={IconRotations.THREE_QUARTERS}
          size={IconSizes.LG}
        />
      </IconButton>
    </span>
  );
}
