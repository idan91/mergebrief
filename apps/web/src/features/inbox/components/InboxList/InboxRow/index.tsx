import { Link } from "@tanstack/react-router";
import { useRef, type CSSProperties, type Ref } from "react";
import { useTranslation } from "react-i18next";
import type { InboxArchivedFilter, InboxSort } from "types/inbox";

import { AuthorChip } from "@web/components/AuthorChip";
import { Checkbox } from "@web/components/Checkbox";
import {
  Chip,
  ChipElements,
  ChipTones,
  ChipVariants,
} from "@web/components/Chip";
import { PullRequestSources } from "@web/features/pulls/types";
import { ScreenReaderOnly } from "@web/components/ScreenReaderOnly";
import { TitleSegmentKinds, type InboxItem } from "../../../types";
import { needsReviewer, pickAgeAt, splitTitleCode } from "../../../utils";
import { Icon } from "@web/components/Icon";
import { IconNames, IconSizes } from "@web/components/Icon/types";
import styles from "./InboxRow.module.scss";
import { RowActions } from "./RowActions";
import { RowEnd } from "./RowEnd";
import { RowMark } from "./RowMark";
import { useRowGeneration } from "./useRowGeneration";
import {
  describeRow,
  formatAgeLabel,
  readOtherAuthor,
  readRowTitle,
} from "./utils";

export interface InboxRowProps {
  item: InboxItem;
  /** Position in the page, for the first-load stagger and the keyboard cursor. */
  index: number;
  sort: InboxSort;
  now: Date;
  /** The keyboard cursor rests on this row. */
  cursor: boolean;
  /** The row is ticked for a bulk action. */
  selected: boolean;
  /** `range` is a shift-click: the rows since the last toggle take this one's state. */
  onToggleSelect: (item: InboxItem, range?: boolean) => void;
  /** The list holds the cursor row so it can scroll it into view. */
  rowRef?: Ref<HTMLLIElement> | undefined;
  /** The view the row sits in, for the archive action's direction. */
  archived: InboxArchivedFilter;
  onAnnounce: (message: string) => void;
  onDelete: (item: InboxItem) => void;
  onPurgeAttachments: (item: InboxItem) => void;
  /** The row archived or unarchived and is leaving the list. */
  onRemoved: (item: InboxItem) => void;
}

/**
 * Two lines, 56px, behind a checkbox for the bulk actions. Line one: the
 * review mark, the title with inline code, the fact chips. Line two: the source icon on url rows, repository, number
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
  selected,
  onToggleSelect,
  rowRef,
  archived,
  onAnnounce,
  onDelete,
  onPurgeAttachments,
  onRemoved,
}: InboxRowProps) {
  const { t } = useTranslation();
  const generation = useRowGeneration(item);
  const ageAt = pickAgeAt(item, sort);
  const titleSegments = splitTitleCode(
    readRowTitle(item.title) ??
      t("home.inbox.number", { number: item.prNumber }),
  );
  const repoLabel = item.repoSlug ?? item.repoId;
  const stackPosition = item.stack === null ? null : { ...item.stack };
  const age = ageAt === null ? null : formatAgeLabel(t, ageAt, now);
  const description = describeRow(t, item, generation);
  const rowStyle: CSSProperties & { "--index": number } = { "--index": index };

  // The change event carries no modifier; the click before it does.
  const shiftRef = useRef(false);
  function handleToggle(): void {
    onToggleSelect(item, shiftRef.current);
  }
  function handleRemoved(): void {
    onRemoved(item);
  }

  const otherAuthor = readOtherAuthor(item);

  return (
    <li
      className={styles["row"]}
      data-cursor={cursor}
      data-needs-you={needsReviewer(item)}
      data-selected={selected}
      data-testid="inbox-row"
      data-unreachable={item.unreachable}
      ref={rowRef}
      style={rowStyle}
    >
      <span
        className={styles["start"]}
        onClickCapture={(event) => {
          shiftRef.current = event.shiftKey;
        }}
      >
        <Checkbox checked={selected} onChange={handleToggle}>
          <ScreenReaderOnly>
            {t("home.inbox.select.row", {
              title:
                readRowTitle(item.title) ??
                t("home.inbox.number", { number: item.prNumber }),
            })}
          </ScreenReaderOnly>
        </Checkbox>
      </span>
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
          {stackPosition === null ? null : (
            <Chip
              as={ChipElements.SPAN}
              className={styles["chip"]}
              variant={ChipVariants.FACT}
            >
              <Icon name={IconNames.STACK} size={IconSizes.SM} />
              <ScreenReaderOnly>
                {t("home.inbox.stackChipLabel", stackPosition)}
              </ScreenReaderOnly>
              <span aria-hidden="true">
                {t("home.inbox.stackChip", stackPosition)}
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
          {otherAuthor === undefined ? null : (
            <span aria-hidden="true">
              <AuthorChip linked={false} login={otherAuthor} />
            </span>
          )}
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
        <RowActions
          archived={archived}
          item={item}
          onAnnounce={onAnnounce}
          onDelete={onDelete}
          onPurgeAttachments={onPurgeAttachments}
          onRemoved={handleRemoved}
        />
      </span>
    </li>
  );
}
