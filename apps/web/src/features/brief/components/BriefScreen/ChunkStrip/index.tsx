import { useTranslation } from "react-i18next";

import type { BriefChunk } from "../../../types";
import { useChunkStripFacade } from "./useChunkStripFacade";
import { deriveMarkName } from "./utils";
import styles from "./ChunkStrip.module.scss";

export interface ChunkStripProps {
  groupId: string;
  chunks: readonly BriefChunk[];
  jumpToChunk: (chunkId: string) => void;
}

/**
 * One mark per chunk in reading order, the reader's chunk marked live. The
 * caption is not a live region: spy ticks stay silent, and a focused mark's
 * own name carries the announcement.
 */
export function ChunkStrip({ groupId, chunks, jumpToChunk }: ChunkStripProps) {
  const { t } = useTranslation();
  const facade = useChunkStripFacade({ groupId, chunks, jumpToChunk });
  const { marks, shown } = facade;
  const total = marks.length;

  return (
    <div>
      <div
        aria-label={t("brief.chunkStrip.label")}
        aria-orientation="horizontal"
        className={styles["marks"]}
        role="toolbar"
        tabIndex={-1}
        onBlur={facade.leaveToolbar}
        onKeyDown={facade.moveFocus}
      >
        {marks.map((mark, index) => {
          const current = index === facade.activeIndex;
          const peeked = index === facade.peekIndex;
          const isTabStop = index === facade.tabStop;
          const name = deriveMarkName(t, mark, total);

          return (
            // oxlint-disable-next-line house/no-raw-button -- a bare 24px position mark: the bar is its ::before, no label box
            <button
              aria-current={current ? "true" : undefined}
              aria-label={name}
              className={styles["mark"]}
              data-state={peeked ? "peek" : undefined}
              key={mark.id}
              ref={(node) => {
                facade.markRefs.current[index] = node;
              }}
              tabIndex={isTabStop ? 0 : -1}
              type="button"
              onClick={() => facade.activateMark(mark.id)}
              onFocus={() => facade.focusMark(mark.id)}
              onPointerDown={facade.pressMark}
              onPointerEnter={(event) => facade.hoverMark(event, mark.id)}
              onPointerLeave={facade.leaveMark}
            />
          );
        })}
      </div>
      <p className={styles["caption"]}>
        {shown ? (
          <>
            <span className={styles["name"]}>
              {shown.basename}
              {shown.line === undefined ? null : (
                <span className={styles["line"]}> :{shown.line}</span>
              )}
            </span>
            <span className={styles["position"]}>
              {t("brief.chunkStrip.position", {
                index: shown.position,
                total,
              })}
            </span>
          </>
        ) : (
          <span className={styles["position"]}>
            {t("brief.chunkStrip.count", { count: total })}
          </span>
        )}
      </p>
    </div>
  );
}
