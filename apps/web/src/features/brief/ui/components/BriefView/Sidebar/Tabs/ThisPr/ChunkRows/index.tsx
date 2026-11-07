import { formatDisplayPath } from "brief-core/hidden-chars";
import { useTranslation } from "react-i18next";

import { Icon } from "@web/components/Icon";
import { IconNames, IconSizes } from "@web/components/Icon/types";
import { LocSign, LocSigns } from "@web/components/LocSign";
import { ScreenReaderOnly } from "@web/components/ScreenReaderOnly";
import { useReviewSession } from "@web/features/review/session";

import type { BriefChunk } from "../../../../../../../model/types";
import { useReadingPosition } from "../../../../reading/reading-position";
import type { JumpChunkFromSidebar } from "../../../types";
import { deriveChunkRowPath } from "./utils";
import styles from "./ChunkRows.module.scss";

export interface ChunkRowsProps {
  chunks: readonly BriefChunk[];
  jumpToChunk: JumpChunkFromSidebar;
}

/** A group's chunks in the Sidebar sheet: each a jump, the one being read marked, the viewed ones ticked. */
export function ChunkRows({ chunks, jumpToChunk }: ChunkRowsProps) {
  const { t } = useTranslation();
  const activeChunkId = useReadingPosition(
    (position) => position.activeChunkId,
  );
  const reviewedChunks = useReviewSession((state) => state.reviewedChunks);

  return (
    <ol className={styles["list"]}>
      {chunks.map((chunk) => {
        const viewed = reviewedChunks.has(chunk.id);
        const current = chunk.id === activeChunkId;
        const path = deriveChunkRowPath(formatDisplayPath(chunk.file));
        return (
          <li key={chunk.id}>
            {/* oxlint-disable-next-line house/no-raw-button -- a list row on an alignment grid: block content the shared Button does not model */}
            <button
              aria-current={current ? "true" : undefined}
              className={styles["row"]}
              data-chunk-row=""
              data-viewed={viewed ? "" : undefined}
              type="button"
              onClick={(event) => jumpToChunk(chunk.id, event)}
            >
              <span aria-hidden="true" className={styles["status"]}>
                <Icon name={IconNames.CHECK} size={IconSizes.SM} />
              </span>
              <span className={styles["file"]}>
                <bdi dir="ltr">
                  {path.folder === undefined ? null : (
                    <span className={styles["folder"]}>{path.folder}</span>
                  )}
                  {path.fileName}
                </bdi>
                {viewed ? (
                  <ScreenReaderOnly>
                    {` ${t("brief.chunk.viewed")}`}
                  </ScreenReaderOnly>
                ) : null}
              </span>
              <span className={styles["counts"]}>
                <LocSign count={chunk.loc.added} sign={LocSigns.ADD} />{" "}
                <LocSign count={chunk.loc.deleted} sign={LocSigns.DEL} />
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
