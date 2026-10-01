import type { Ref } from "react";
import { useTranslation } from "react-i18next";

import { Icon } from "@web/components/Icon";
import { IconNames, IconSizes } from "@web/components/Icon/types";
import { IconButton } from "@web/components/IconButton";
import { ScreenReaderOnly } from "@web/components/ScreenReaderOnly";
import type { GroupView } from "../../../utils/viewModel";
import { ReadThroughProgress } from "../ReadThroughProgress";
import { useReadingPosition } from "../readingPosition";
import styles from "./FocusIndicator.module.scss";

export interface FocusIndicatorProps {
  groups: GroupView[];
  jumpToChunk: (chunkId: string) => void;
  exitFocusMode: () => void;
  /** The session measures this frame into --focus-indicator-h. */
  indicatorRef: Ref<HTMLDivElement>;
}

export function FocusIndicator({
  groups,
  jumpToChunk,
  exitFocusMode,
  indicatorRef,
}: FocusIndicatorProps) {
  const { t } = useTranslation();
  const activeGroupId = useReadingPosition((state) => state.activeGroupId);
  const activeGroup = groups.find((group) => group.id === activeGroupId);
  const groupNumber = activeGroup ? activeGroup.index + 1 : undefined;
  const countLabel =
    groupNumber === undefined
      ? undefined
      : t("brief.focusIndicator.groupOf", {
          index: groupNumber,
          total: groups.length,
        });

  return (
    <div className={styles["stickyWrapper"]}>
      <div
        className={styles["focusIndicator"]}
        data-testid="focus-indicator"
        ref={indicatorRef}
      >
        <div
          aria-label={t("brief.focusIndicator.ariaLabel")}
          className={styles["pill"]}
          role="group"
        >
          <span aria-hidden="true" className={styles["label"]}>
            {t("brief.focusIndicator.label")}
          </span>
          <ReadThroughProgress groups={groups} jumpToChunk={jumpToChunk} />
          {groupNumber === undefined ? null : (
            <>
              <span aria-hidden="true" className={styles["countFigures"]}>
                <b>{groupNumber}</b>
                <span>/</span>
                <span>{groups.length}</span>
              </span>
              <ScreenReaderOnly>{countLabel}</ScreenReaderOnly>
            </>
          )}
          <span aria-hidden="true" className={styles["separator"]} />
          <IconButton
            callout="bottom"
            label={t("brief.focusIndicator.exit")}
            onClick={exitFocusMode}
          >
            <Icon name={IconNames.X} size={IconSizes.MD} />
          </IconButton>
        </div>
      </div>
    </div>
  );
}
