import { useTranslation } from "react-i18next";
import clsx from "clsx";

import { Button, ButtonSizes, ButtonVariants } from "@web/components/Button";
import { ScreenReaderOnly } from "@web/components/ScreenReaderOnly";
import styles from "./LargeChunkNotice.module.scss";

export interface LargeChunkNoticeProps {
  /** The card's frame colour for its reviewed and current states. */
  className?: string | undefined;
  /** Names the button apart from every other large chunk's. */
  file: string;
  changedLines: number;
  showDiff: () => void;
}

export function LargeChunkNotice({
  className,
  file,
  changedLines,
  showDiff,
}: LargeChunkNoticeProps) {
  const { t } = useTranslation();

  return (
    <div
      className={clsx(styles["notice"], className)}
      data-testid="large-chunk-notice"
    >
      <p className={styles["text"]}>
        <span className={styles["label"]}>{t("brief.chunk.largeDiff")}</span>
        {t("brief.chunk.largeDiffHidden", { count: changedLines })}
      </p>
      <Button
        size={ButtonSizes.SM}
        variant={ButtonVariants.SECONDARY}
        onClick={showDiff}
      >
        {t("brief.chunk.showDiff")}
        <ScreenReaderOnly>{` ${file}`}</ScreenReaderOnly>
      </Button>
    </div>
  );
}
