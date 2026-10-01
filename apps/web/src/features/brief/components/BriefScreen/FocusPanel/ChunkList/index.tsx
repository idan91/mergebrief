import { useId } from "react";
import { useTranslation } from "react-i18next";

import type { BriefChunk } from "../../../../types";
import { ChunkRow } from "./ChunkRow";
import styles from "./ChunkList.module.scss";

export interface ChunkListProps {
  chunks: readonly BriefChunk[];
  activeChunkId: string | null;
  jumpToChunk: (chunkId: string) => void;
}

export function ChunkList({
  chunks,
  activeChunkId,
  jumpToChunk,
}: ChunkListProps) {
  const { t } = useTranslation();
  const headingId = useId();

  return (
    <section aria-labelledby={headingId} className={styles["chunkList"]}>
      <h3 className={styles["label"]} id={headingId}>
        {t("brief.focusPanel.chunks")}
      </h3>
      <ul className={styles["rows"]}>
        {chunks.map((chunk) => {
          const current = chunk.id === activeChunkId;

          return (
            <ChunkRow
              chunk={chunk}
              current={current}
              jumpToChunk={jumpToChunk}
              key={chunk.id}
            />
          );
        })}
      </ul>
    </section>
  );
}
