import type { Ref } from "react";
import { useTranslation } from "react-i18next";

import { Icon } from "@web/components/Icon";
import { IconNames, IconSizes } from "@web/components/Icon/types";
import { IconButton } from "@web/components/IconButton";
import { ScreenReaderOnly } from "@web/components/ScreenReaderOnly";
import type { GroupView } from "../../../utils/viewModel";
import { ReadThroughProgress } from "../ReadThroughProgress";
import { useReadingPosition } from "../readingPosition";
import { deriveFocusCount, describeFocusCount } from "./utils";
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
  const count = deriveFocusCount(groups, activeGroupId);
  const countLabel = count ? describeFocusCount(t, count) : undefined;

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
          {count ? (
            <>
              <span aria-hidden="true" className={styles["countFigures"]}>
                <b>{count.position}</b>
                <span>/</span>
                <span>{count.total}</span>
              </span>
              <ScreenReaderOnly>{countLabel}</ScreenReaderOnly>
            </>
          ) : null}
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
