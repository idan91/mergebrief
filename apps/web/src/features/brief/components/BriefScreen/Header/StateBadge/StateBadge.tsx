import { useTranslation } from "react-i18next";
import { ScreenReaderOnly } from "@web/components/ScreenReaderOnly/ScreenReaderOnly";
import type { ValueOf } from "types";
import type { LivePrState, PrRef } from "../../../../types";
import styles from "./StateBadge.module.scss";

export interface StateBadgeProps {
  /**
   * The artifact's stamped `pr` block — the LOCAL path's data source.
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

const BADGE_LABEL: Record<BadgeVariant, string> = {
  open: "Open",
  draft: "Draft",
  merged: "Merged",
  closed: "Closed",
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
    if (live.state === "merged") return BadgeVariants.MERGED;
    if (live.state === "closed") return BadgeVariants.CLOSED;
    return live.draft ? BadgeVariants.DRAFT : BadgeVariants.OPEN;
  }
  if (pr.state === undefined) return null;
  if (pr.merged === true) return BadgeVariants.MERGED;
  if (pr.state === "closed") return BadgeVariants.CLOSED;
  if (pr.draft === true) return BadgeVariants.DRAFT;
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
  if (variant === null) return null;
  return (
    <span
      className={styles["badge"]}
      data-state-badge=""
      data-variant={variant}
    >
      <ScreenReaderOnly>{t("brief.stateBadge.pullRequest")}</ScreenReaderOnly>
      {BADGE_LABEL[variant]}
    </span>
  );
}
