import { Link, useMatchRoute } from "@tanstack/react-router";
import type { CSSProperties, Ref } from "react";
import { useTranslation } from "react-i18next";
import {
  type InboxArchivedFilter,
  type InboxSort,
  PullRequestSources,
} from "types";

import { AuthorChip } from "@web/components/AuthorChip";
import {
  Chip,
  ChipElements,
  ChipTones,
  ChipVariants,
} from "@web/components/Chip";
import { NAVIGATION_NOTICE_DELAY } from "@web/components/NavigationProgress/consts";
import { ScreenReaderOnly } from "@web/components/ScreenReaderOnly";
import { TitleSegmentKinds, type InboxItem } from "../../../types";
import { needsReviewer, pickAgeAt, splitTitleCode } from "../../../utils";
import { Icon } from "@web/components/Icon";
import { IconNames, IconSizes } from "@web/components/Icon/types";
import styles from "./InboxRow.module.scss";
import { RowActions } from "./RowActions";
import { RowEnd } from "./RowEnd";
import { RowLead } from "./RowLead";
import { RowMark } from "./RowMark";
import { useRowGeneration } from "./useRowGeneration";
import {
  describeRow,
  formatAgeLabel,
  readOtherAuthor,
  readRowTitle,
} from "./utils";

type RowStyle = CSSProperties & {
  "--index": number;
  "--notice-delay": typeof NAVIGATION_NOTICE_DELAY;
};

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
  /** Rows are being selected, so every row shows its box. */
  selecting?: boolean;
  /** `range` is a shift-click: the rows since the last tick take `checked`. */
  onSelectRow: (item: InboxItem, checked: boolean, range?: boolean) => void;
  /** The list holds the cursor row so it can scroll it into view. */
  rowRef?: Ref<HTMLLIElement> | undefined;
  /** The view the row sits in, for the archive action's direction. */
  archived: InboxArchivedFilter;
  /** A restore is pending, so this row's Archive waits for it. */
  archiveHeld: boolean;
  /** Every matching row is being read for a bulk action, so this row's Delete waits. */
  deleteHeld: boolean;
  onAnnounce: (message: string) => void;
  onArchived: (message: string, gone: readonly InboxItem[]) => void;
  onDelete: (item: InboxItem) => void;
  onPurgeAttachments: (item: InboxItem) => void;
  /** The row archived or unarchived and is leaving the list. */
  onRemoved: (item: InboxItem) => void;
}

/**
 * Two lines, 56px: the title with its chips, then the source, repository,
 * number and age. The lead slot holds the review mark, and the selection
 * checkbox takes its place on hover, keyboard focus and while rows are being
 * selected; the checkbox stays in the tab order and accessibility tree. The
 * right edge carries the generation state, a status other than Open and the
 * actions. The whole row is one link to the brief; the lead slot sits above
 * it, so the pointer meets the slot and its state callout over the mark.
 */
export function InboxRow({
  item,
  index,
  sort,
  now,
  cursor,
  selected,
  selecting = false,
  onSelectRow,
  rowRef,
  archived,
  archiveHeld,
  deleteHeld,
  onAnnounce,
  onArchived,
  onDelete,
  onPurgeAttachments,
  onRemoved,
}: InboxRowProps) {
  const { t } = useTranslation();
  const rowParams = { repoId: item.repoId, prNumber: String(item.prNumber) };
  const matchRoute = useMatchRoute();
  const pendingMatch = matchRoute({
    to: "/repos/$repoId/pulls/$prNumber",
    params: rowParams,
    pending: true,
    includeSearch: false,
  });
  const opening = pendingMatch !== false;
  const generation = useRowGeneration(item);
  const ageAt = pickAgeAt(item, sort);
  const rowTitle =
    readRowTitle(item.title) ??
    t("home.inbox.number", { number: item.prNumber });
  const titleSegments = splitTitleCode(rowTitle);
  const repoLabel = item.repoSlug ?? item.repoId;
  const stackPosition =
    item.stack === undefined ? undefined : { ...item.stack };
  const age = ageAt === undefined ? undefined : formatAgeLabel(t, ageAt, now);
  const description = describeRow(t, item, generation);
  const rowStyle: RowStyle = {
    "--index": index,
    "--notice-delay": NAVIGATION_NOTICE_DELAY,
  };

  function handleSelect(checked: boolean, range: boolean): void {
    onSelectRow(item, checked, range);
  }
  function handleRemoved(): void {
    onRemoved(item);
  }

  const otherAuthor = readOtherAuthor(item);

  return (
    <li
      className={styles["row"]}
      data-cursor={cursor}
      data-opening={opening ? "" : undefined}
      data-needs-you={needsReviewer(item)}
      data-selected={selected}
      data-selecting={selecting}
      data-testid="inbox-row"
      data-unreachable={item.unreachable}
      ref={rowRef}
      style={rowStyle}
    >
      <RowLead
        className={styles["lead"]}
        reviewState={item.reviewState}
        selected={selected}
        title={rowTitle}
        onSelect={handleSelect}
      />
      <Link
        className={styles["main"]}
        params={rowParams}
        to="/repos/$repoId/pulls/$prNumber"
      >
        <ScreenReaderOnly>{description}</ScreenReaderOnly>{" "}
        <span className={styles["state"]}>
          <RowMark reviewState={item.reviewState} />
        </span>
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
          {stackPosition === undefined ? null : (
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
              tone={ChipTones.CHANGED}
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
            <span aria-hidden="true" className={styles["author"]}>
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
          {age === undefined ? null : (
            <span suppressHydrationWarning>{age}</span>
          )}
        </span>
      </Link>
      <span className={styles["end"]}>
        <RowEnd draft={item.draft} generation={generation} state={item.state} />
        <RowActions
          archived={archived}
          archiveHeld={archiveHeld}
          deleteHeld={deleteHeld}
          item={item}
          onAnnounce={onAnnounce}
          onArchived={onArchived}
          onDelete={onDelete}
          onPurgeAttachments={onPurgeAttachments}
          onRemoved={handleRemoved}
        />
      </span>
    </li>
  );
}
