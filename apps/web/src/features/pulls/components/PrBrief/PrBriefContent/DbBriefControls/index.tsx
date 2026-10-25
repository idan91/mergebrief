// Scope and comparison controls + revision notices, rendered inside the sticky page
// Header's control slot: the header measures itself into --top-bar-h, so the
// controls stay reachable after the focus-to-heading selection effect.
import { useTranslation } from "react-i18next";
import { DbCompareBar, type DbCompareBarProps } from "./DbCompareBar";
import { BehindNotice } from "./BehindNotice";
import type { BehindNoticeState } from "./BehindNotice/useBehindNoticeFacade";
import { LatestPushNotice } from "./LatestPushNotice";
import type { LatestPushNoticeState } from "./LatestPushNotice/useLatestPushNotice";
import { StaleRevisionChip } from "./StaleRevisionChip";
import styles from "./DbBriefControls.module.scss";

export interface DbBriefControlsProps {
  /** The scope and comparison wiring. */
  compare: DbCompareBarProps;
  /**
   * Compact status line under the controls (e.g. a degraded revision link).
   * Display only; the page live region owns the SR announcement.
   */
  note?: string | undefined;
  /** The selected revision is read-only (not the PR's current span). */
  readOnly?: boolean | undefined;
  /** The rendered span is behind the PR head; absent when it is current. */
  staleHead?: boolean | undefined;
  /** Present only when a newer briefed revision exists to move to. */
  onGoToNewest?: (() => void) | undefined;
  /** The behind notice and its announcements; the notice itself is present only while GitHub is ahead. */
  behind?: BehindNoticeState | undefined;
  /** The latest push's notice and its announcements; the notice is present only while that push has no brief. */
  latestPush?: LatestPushNoticeState | undefined;
}

export function DbBriefControls({
  compare,
  note,
  readOnly,
  staleHead,
  onGoToNewest,
  behind,
  latestPush,
}: DbBriefControlsProps) {
  const { t } = useTranslation();
  const showRevisionRegion =
    staleHead === true ||
    readOnly === true ||
    behind?.notice !== undefined ||
    latestPush?.notice !== undefined;
  return (
    <>
      {/* The notice leaves once the brief it asked for lands; its outcomes
          announce from here, which stays. */}
      {behind === undefined ? null : (
        <span
          aria-atomic="true"
          aria-live="polite"
          className="sr-only"
          role="status"
        >
          {behind.announcement}
        </span>
      )}
      {latestPush === undefined ? null : (
        <span
          aria-atomic="true"
          aria-live="polite"
          className="sr-only"
          role="status"
        >
          {latestPush.announcement}
        </span>
      )}
      <div className={styles["comparisonRegion"]}>
        <DbCompareBar {...compare} />
        {note !== undefined ? <p className={styles["note"]}>{note}</p> : null}
      </div>
      {showRevisionRegion ? (
        <div className={styles["revisionRow"]}>
          {staleHead ? (
            <StaleRevisionChip {...(onGoToNewest ? { onGoToNewest } : {})} />
          ) : null}
          {latestPush?.notice === undefined ? null : (
            <LatestPushNotice
              action={latestPush.notice.action}
              detail={latestPush.notice.detail}
              label={latestPush.notice.label}
              title={latestPush.notice.title}
            />
          )}
          {behind?.notice === undefined ? null : (
            <BehindNotice
              failure={behind.notice.failure}
              pending={behind.notice.pending}
              queued={behind.notice.queued}
              queuedNotice={behind.notice.queuedNotice}
              onRegenerate={behind.notice.onRegenerate}
            />
          )}
          {readOnly ? (
            // Factual chip, not a verdict: the reachable REASON lives on the
            // disabled controls themselves (diff rows, submit).
            <span className={styles["readOnlyChip"]}>
              {t("pulls.compare.readOnlyChip")}
            </span>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
