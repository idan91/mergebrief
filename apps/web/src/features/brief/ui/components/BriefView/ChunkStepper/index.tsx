import { useTranslation } from "react-i18next";

import { Icon } from "@web/components/Icon";
import {
  IconNames,
  IconRotations,
  IconSizes,
} from "@web/components/Icon/types";
import { IconButton } from "@web/components/IconButton";
import { resolveChunkStepTargets } from "./utils";
import styles from "./ChunkStepper.module.scss";

export interface ChunkStepperProps {
  /** The chunks on the page, in reading order. */
  chunkIds: readonly string[];
  /** The chunk the reader is at; absent from the Overview. */
  activeChunkId: string | undefined;
  jumpToChunk: (chunkId: string) => void;
}

/** Previous and Next chunk, 44px each, stepping the reading order one chunk at a time. */
export function ChunkStepper({
  chunkIds,
  activeChunkId,
  jumpToChunk,
}: ChunkStepperProps) {
  const { t } = useTranslation();
  const targets = resolveChunkStepTargets(chunkIds, activeChunkId);

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
