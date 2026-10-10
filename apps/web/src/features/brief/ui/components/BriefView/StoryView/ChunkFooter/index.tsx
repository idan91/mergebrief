import { useTranslation } from "react-i18next";

import { ButtonVariants } from "@web/components/Button";
import { useReviewSession } from "@web/features/review/session";
import type { GroupView } from "../../../../../model/utils/viewModel";
import { useReadingPosition } from "../../readingPosition";
import { StepButton } from "./StepButton";
import { deriveChunkSteps } from "./utils";
import styles from "./ChunkFooter.module.scss";

export interface ChunkFooterWiring {
  jumpToChunk: (chunkId: string) => void;
  toggleViewed: (chunkId: string) => void;
}

export interface ChunkFooterProps {
  groups: GroupView[];
  wiring: ChunkFooterWiring;
  marksDisabled?: boolean | undefined;
}

/**
 * Mounted once beside the story groups, so a step into another group keeps
 * focus on the button that took it there.
 */
export function ChunkFooter({
  groups,
  wiring,
  marksDisabled = false,
}: ChunkFooterProps) {
  const { t } = useTranslation();
  const activeChunkId = useReadingPosition((state) => state.activeChunkId);
  const viewed = useReviewSession(
    (state) =>
      activeChunkId !== null && state.reviewedChunks.has(activeChunkId),
  );
  if (activeChunkId === null) {
    return null;
  }

  const { previous, next } = deriveChunkSteps(groups, activeChunkId);
  const previousLabel = previous?.crossesGroup
    ? t("brief.chunkFooter.previousGroup")
    : t("brief.chunkFooter.previousChunk");
  const nextLabel = next?.crossesGroup
    ? t("brief.chunkFooter.nextGroup")
    : t("brief.chunkFooter.nextChunk");
  const viewedLabel = viewed
    ? t("brief.chunkFooter.markUnviewed")
    : t("brief.chunkFooter.markViewed");

  const stepBack = () => {
    if (previous) {
      wiring.jumpToChunk(previous.chunkId);
    }
  };
  const stepOn = () => {
    if (next) {
      wiring.jumpToChunk(next.chunkId);
    }
  };
  const toggleViewed = () => wiring.toggleViewed(activeChunkId);

  return (
    <div
      aria-label={t("brief.chunkFooter.ariaLabel")}
      className={styles["footer"]}
      data-testid="chunk-footer"
      role="group"
    >
      <StepButton
        disabled={!previous}
        label={previousLabel}
        shortcut="K"
        variant={ButtonVariants.QUIET}
        onClick={stepBack}
      />
      <div className={styles["end"]}>
        <StepButton
          disabled={marksDisabled}
          label={viewedLabel}
          shortcut="V"
          variant={ButtonVariants.SECONDARY}
          onClick={toggleViewed}
        />
        <StepButton
          disabled={!next}
          label={nextLabel}
          shortcut="J"
          variant={ButtonVariants.ACCENT}
          onClick={stepOn}
        />
      </div>
    </div>
  );
}
