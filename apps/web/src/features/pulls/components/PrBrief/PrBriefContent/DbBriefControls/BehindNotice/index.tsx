import { useTranslation } from "react-i18next";

import { Button } from "@web/components/Button";
import { Chip } from "@web/components/Chip";
import { handOffFocusOnRemoval } from "../../../../../utils/focus-hand-off";
import noticeStyles from "../revision-notices.module.scss";
import styles from "./BehindNotice.module.scss";

export interface BehindNoticeProps {
  /** A generation for the new head is already queued or running. */
  queued: boolean;
  /** The regenerate request is in flight. */
  pending: boolean;
  /** The draft refresh window, while the author's regeneration is queued. */
  queuedNotice?: string | undefined;
  /** The last refusal's curated line; absent until one. */
  failure?: string | undefined;
  /** Absent on an installation row, and while the repository name is unknown. */
  onRegenerate?: (() => void) | undefined;
}

/**
 * GitHub has commits the latest brief does not cover. Unlike the stale
 * chip, which points at a newer brief that already exists, this one offers
 * a url row to make it: Regenerate goes through the paste path and the
 * button stays where focus left it, saying queued once a generation is on
 * its way. An installation row shows the chip alone. The notice leaves once
 * the new brief lands, and hands focus to the main landmark if it still
 * held it.
 */
export function BehindNotice({
  queued,
  pending,
  queuedNotice,
  failure,
  onRegenerate,
}: BehindNoticeProps) {
  const { t } = useTranslation();
  const label = queued
    ? t("pulls.behind.queued")
    : t("pulls.behind.regenerate");

  return (
    <span
      className={noticeStyles["notice"]}
      data-testid="behind-notice"
      ref={handOffFocusOnRemoval}
    >
      <Chip as="span" title={t("pulls.behind.title")} tone="warning">
        {t("pulls.behind.label")}
      </Chip>
      {onRegenerate === undefined ? null : (
        <Button
          disabled={queued}
          loading={pending}
          size="sm"
          type="button"
          variant="secondary"
          onClick={onRegenerate}
        >
          {label}
        </Button>
      )}
      {queuedNotice === undefined ? null : (
        <span className={styles["window"]}>{queuedNotice}</span>
      )}
      {failure === undefined ? null : (
        <span className={styles["failed"]}>{failure}</span>
      )}
    </span>
  );
}
