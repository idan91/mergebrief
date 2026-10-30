import type { PrRef } from "brief-core/types";
import { useTranslation } from "react-i18next";
import { Icon } from "@web/components/Icon";
import { IconSizes } from "@web/components/Icon/types";
import { ScreenReaderOnly } from "@web/components/ScreenReaderOnly";
import { PrStates } from "types";
import { UnknownValues } from "@web/utils/open-enum/types";
import type { LivePrState } from "../../../../model/types";
import { PR_STATE_BADGE_ICONS, PR_STATE_BADGE_LABEL_KEYS } from "../consts";
import { PrStateBadgeVariants, type PrStateBadgeVariant } from "../types";
import styles from "./StateBadge.module.scss";

export interface StateBadgeProps {
  /**
   * The artifact's stamped `pr` block; the LOCAL path's data source.
   * Pre-stamping artifacts carry no `state`, and without a live overlay the
   * badge simply doesn't render; there is no fallback.
   */
  pr: PrRef;
  /** Live webhook-maintained state (DB route); supersedes the stamp. */
  live?: LivePrState | undefined;
}

/**
 * GitHub conventions: merged wins over closed (a merged PR's wire state IS
 * closed), draft supersedes open. The live DB vocabulary folds merged INTO
 * the state; the artifact stamp carries it as a separate boolean. A live
 * state this bundle predates renders no badge rather than a wrong word.
 */
function badgeVariant(
  pr: PrRef,
  live: LivePrState | undefined,
): PrStateBadgeVariant | null {
  if (live) {
    if (live.state === UnknownValues.UNKNOWN) {
      return null;
    }
    if (live.state === PrStates.MERGED) {
      return PrStateBadgeVariants.MERGED;
    }
    if (live.state === PrStates.CLOSED) {
      return PrStateBadgeVariants.CLOSED;
    }
    const openVariant = live.draft
      ? PrStateBadgeVariants.DRAFT
      : PrStateBadgeVariants.OPEN;
    return openVariant;
  }
  if (pr.state === undefined) {
    return null;
  }
  if (pr.merged === true) {
    return PrStateBadgeVariants.MERGED;
  }
  if (pr.state === "closed") {
    return PrStateBadgeVariants.CLOSED;
  }
  if (pr.draft === true) {
    return PrStateBadgeVariants.DRAFT;
  }
  return PrStateBadgeVariants.OPEN;
}

/**
 * The PR state pill. The visible text is the state word alone; screen
 * readers get a "pull request" prefix so the word isn't free-floating in the
 * header's reading order.
 */
export function StateBadge({ pr, live }: StateBadgeProps) {
  const { t } = useTranslation();
  const variant = badgeVariant(pr, live);
  if (variant === null) {
    return null;
  }
  const label = t(PR_STATE_BADGE_LABEL_KEYS[variant]);
  return (
    <span
      className={styles["badge"]}
      data-state-badge=""
      data-variant={variant}
    >
      <Icon name={PR_STATE_BADGE_ICONS[variant]} size={IconSizes.SM} />
      <ScreenReaderOnly>{t("brief.stateBadge.pullRequest")}</ScreenReaderOnly>
      {label}
    </span>
  );
}
