import type { PrRef } from "brief-core/types";
import type { TranslationKey } from "i18n";
import { useTranslation } from "react-i18next";
import { Icon } from "@web/components/Icon";
import {
  IconNames,
  IconSizes,
  type IconName,
} from "@web/components/Icon/types";
import { ScreenReaderOnly } from "@web/components/ScreenReaderOnly";
import type { ValueOf } from "types/utils";
import type { LivePrState } from "../../../../../model/types";
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

const BadgeVariants = {
  OPEN: "open",
  DRAFT: "draft",
  MERGED: "merged",
  CLOSED: "closed",
} as const;

type BadgeVariant = ValueOf<typeof BadgeVariants>;

/** The status glyph ahead of the word, the same drawings Home's row end uses. */
const BADGE_ICON: Record<BadgeVariant, IconName> = {
  [BadgeVariants.OPEN]: IconNames.GIT_PULL_REQUEST,
  [BadgeVariants.DRAFT]: IconNames.CIRCLE_DASHED,
  [BadgeVariants.MERGED]: IconNames.GIT_MERGE,
  [BadgeVariants.CLOSED]: IconNames.X_CIRCLE,
};

const BADGE_LABEL_KEYS: Record<BadgeVariant, TranslationKey> = {
  [BadgeVariants.OPEN]: "brief.stateBadge.open",
  [BadgeVariants.DRAFT]: "brief.stateBadge.draft",
  [BadgeVariants.MERGED]: "brief.stateBadge.merged",
  [BadgeVariants.CLOSED]: "brief.stateBadge.closed",
};

/**
 * GitHub conventions: merged wins over closed (a merged PR's wire state IS
 * closed), draft supersedes open. The live DB vocabulary folds merged INTO
 * the state; the artifact stamp carries it as a separate boolean.
 */
function badgeVariant(
  pr: PrRef,
  live: LivePrState | undefined,
): BadgeVariant | null {
  if (live) {
    if (live.state === "merged") {
      return BadgeVariants.MERGED;
    }
    if (live.state === "closed") {
      return BadgeVariants.CLOSED;
    }
    return live.draft ? BadgeVariants.DRAFT : BadgeVariants.OPEN;
  }
  if (pr.state === undefined) {
    return null;
  }
  if (pr.merged === true) {
    return BadgeVariants.MERGED;
  }
  if (pr.state === "closed") {
    return BadgeVariants.CLOSED;
  }
  if (pr.draft === true) {
    return BadgeVariants.DRAFT;
  }
  return BadgeVariants.OPEN;
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
  const label = t(BADGE_LABEL_KEYS[variant]);
  return (
    <span
      className={styles["badge"]}
      data-state-badge=""
      data-variant={variant}
    >
      <Icon name={BADGE_ICON[variant]} size={IconSizes.SM} />
      <ScreenReaderOnly>{t("brief.stateBadge.pullRequest")}</ScreenReaderOnly>
      {label}
    </span>
  );
}
