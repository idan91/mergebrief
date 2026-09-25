import { Link } from "@tanstack/react-router";
import type { CSSProperties, Ref } from "react";
import { useTranslation } from "react-i18next";
import type { InboxSort } from "types/inbox";

import {
  Chip,
  ChipElements,
  ChipTones,
  ChipVariants,
} from "@web/components/Chip/Chip";
import { PullRequestSources } from "@web/features/pulls/types";
import { ScreenReaderOnly } from "@web/components/ScreenReaderOnly/ScreenReaderOnly";
import { TitleSegmentKinds, type InboxItem } from "../../../types";
import { needsReviewer, pickAgeAt, splitTitleCode } from "../../../utils";
import { Icon } from "@web/components/Icon/Icon";
import { IconNames, IconSizes } from "@web/components/Icon/types";
import styles from "./InboxRow.module.scss";
import { RowActions } from "./RowActions/RowActions";
import { RowEnd } from "./RowEnd/RowEnd";
import { RowMark } from "./RowMark/RowMark";
import { useRowGeneration } from "./useRowGeneration";
import { describeRow, formatAgeLabel, readRowTitle } from "./utils";

export interface InboxRowProps {
  item: InboxItem;
  /** Position in the page, for the first-load stagger and the keyboard cursor. */
  index: number;
  sort: InboxSort;
  now: Date;
  /** The keyboard cursor rests on this row. */
  cursor: boolean;
  /** The list holds the cursor row so it can scroll it into view. */
  rowRef?: Ref<HTMLLIElement> | undefined;
  onAnnounce: (message: string) => void;
  onDelete: (item: InboxItem) => void;
}

/**
 * Two lines, 56px. Line one: the review mark, the title with inline code,
 * the fact chips. Line two: the source icon on url rows, repository, number
 * and age. The right edge carries the generation state and the status when
 * it is not Open, and the actions a hover or the cursor reveals. The whole
 * row is one link to the brief, named by its states before its title; the
 * mark sits inside the link, so its callout can rise above the overlay and
 * a click on it still opens the row.
 */
export function InboxRow({
  item,
  index,
  sort,
  now,
  cursor,
  rowRef,
  onAnnounce,
  onDelete,
}: InboxRowProps) {
  const { t } = useTranslation();
  const generation = useRowGeneration(item);
  const ageAt = pickAgeAt(item, sort);
  const titleSegments = splitTitleCode(
    readRowTitle(item.title) ??
      t("home.inbox.number", { number: item.prNumber }),
  );
  const repoLabel = item.repoSlug ?? item.repoId;
  const age = ageAt === null ? null : formatAgeLabel(t, ageAt, now);
  const description = describeRow(t, item, generation);
  const rowStyle: CSSProperties & { "--index": number } = { "--index": index };

  return (
    <li
      className={styles["row"]}
      data-cursor={cursor}
      data-needs-you={needsReviewer(item)}
      data-testid="inbox-row"
      data-unreachable={item.unreachable}
      ref={rowRef}
      style={rowStyle}
    >
      <Link
        className={styles["main"]}
        params={{ repoId: item.repoId, prNumber: String(item.prNumber) }}
        to="/repos/$repoId/pulls/$prNumber"
      >
        <ScreenReaderOnly>{description}</ScreenReaderOnly>{" "}
        <RowMark reviewState={item.reviewState} />
        <span className={styles["title"]}>
          <span className={styles["titleText"]} data-testid="inbox-row-title">
            {titleSegments.map((segment, position) =>
              segment.kind === TitleSegmentKinds.CODE ? (
                <code key={position}>{segment.text}</code>
              ) : (
                segment.text
              ),
            )}
          </span>{" "}
          {item.stack === null ? null : (
            <Chip
              as={ChipElements.SPAN}
              className={styles["chip"]}
              variant={ChipVariants.FACT}
            >
              <Icon name={IconNames.STACK} size={IconSizes.SM} />
              <ScreenReaderOnly>
                {t("home.inbox.stackChipLabel", item.stack)}
              </ScreenReaderOnly>
              <span aria-hidden="true">
                {t("home.inbox.stackChip", item.stack)}
              </span>
            </Chip>
          )}
          {item.unreachable ? (
            <Chip
              as={ChipElements.SPAN}
              className={styles["chip"]}
              tone={ChipTones.MUTED}
              variant={ChipVariants.FACT}
            >
              <Icon name={IconNames.EYE_SLASH} size={IconSizes.SM} />
              <ScreenReaderOnly>
                {t("home.inbox.unreachableChipLabel")}
              </ScreenReaderOnly>
              <span aria-hidden="true">{t("home.inbox.unreachableChip")}</span>
            </Chip>
          ) : null}
          {item.behind ? (
            <Chip
              as={ChipElements.SPAN}
              className={styles["chip"]}
              tone={ChipTones.WARNING}
              variant={ChipVariants.FACT}
            >
              <Icon name={IconNames.ARROW_UP} size={IconSizes.SM} />
              <ScreenReaderOnly>
                {t("home.inbox.behindChipLabel")}
              </ScreenReaderOnly>
              <span aria-hidden="true">{t("home.inbox.behindChip")}</span>
            </Chip>
          ) : null}
        </span>
        <span className={styles["sub"]}>
          {" "}
          {item.source === PullRequestSources.URL ? (
            <span className={styles["source"]}>
              <Icon name={IconNames.LINK} size={IconSizes.SM} />
            </span>
          ) : null}
          <span className={styles["repo"]}>{repoLabel}</span>{" "}
          <span>{t("home.inbox.number", { number: item.prNumber })}</span>{" "}
          {age === null ? null : <span suppressHydrationWarning>{age}</span>}
        </span>
      </Link>
      <span className={styles["end"]}>
        <RowEnd draft={item.draft} generation={generation} state={item.state} />
        <RowActions item={item} onAnnounce={onAnnounce} onDelete={onDelete} />
      </span>
    </li>
  );
}
