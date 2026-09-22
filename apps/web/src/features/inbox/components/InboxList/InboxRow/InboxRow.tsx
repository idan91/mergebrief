import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import type { CSSProperties } from "react";
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
import StackIcon from "../../icons/stack.svg?react";
import EyeSlashIcon from "../../icons/eye-slash.svg?react";
import LinkIcon from "../../icons/link.svg?react";
import styles from "./InboxRow.module.scss";
import { RowEnd } from "./RowEnd/RowEnd";
import { RowMark } from "./RowMark/RowMark";
import { useRowGeneration } from "./useRowGeneration";
import { formatAgeLabel, readRowTitle } from "./utils";

export interface InboxRowProps {
  item: InboxItem;
  /** Position in the page, for the first-load stagger. */
  index: number;
  sort: InboxSort;
  now: Date;
}

/**
 * Two lines, 56px. Line one: the review mark, the title with inline code,
 * the fact chips. Line two: the source icon on url rows, repository, number
 * and age. The right edge carries the generation state and the status when
 * it is not Open. The whole row is one link to the brief.
 */
export function InboxRow({ item, index, sort, now }: InboxRowProps) {
  const { t } = useTranslation();
  const generation = useRowGeneration(item);
  const ageAt = pickAgeAt(item, sort);
  const titleSegments = splitTitleCode(
    readRowTitle(item.title) ??
      t("home.inbox.number", { number: item.prNumber }),
  );
  const repoLabel = item.repoSlug ?? item.repoId;
  const age = ageAt === null ? null : formatAgeLabel(t, ageAt, now);
  const rowStyle: CSSProperties & { "--index": number } = { "--index": index };

  return (
    <li
      className={styles["row"]}
      data-needs-you={needsReviewer(item)}
      data-testid="inbox-row"
      data-unreachable={item.unreachable}
      style={rowStyle}
    >
      <RowMark reviewState={item.reviewState} />
      <Link
        className={styles["main"]}
        params={{ repoId: item.repoId, prNumber: String(item.prNumber) }}
        to="/repos/$repoId/pulls/$prNumber"
      >
        <span className={styles["title"]}>
          <span className={styles["titleText"]}>
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
              <StackIcon aria-hidden="true" />
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
              <EyeSlashIcon aria-hidden="true" />
              <ScreenReaderOnly>
                {t("home.inbox.unreachableChipLabel")}
              </ScreenReaderOnly>
              <span aria-hidden="true">{t("home.inbox.unreachableChip")}</span>
            </Chip>
          ) : null}
        </span>
        <span className={styles["sub"]}>
          {" "}
          {item.source === PullRequestSources.URL ? (
            <span className={styles["source"]}>
              <LinkIcon aria-hidden="true" />
              <ScreenReaderOnly>{t("home.inbox.sourceUrl")}</ScreenReaderOnly>
            </span>
          ) : null}
          <span className={styles["repo"]}>{repoLabel}</span>{" "}
          <span>{t("home.inbox.number", { number: item.prNumber })}</span>{" "}
          {age === null ? null : <span suppressHydrationWarning>{age}</span>}
        </span>
      </Link>
      <RowEnd draft={item.draft} generation={generation} state={item.state} />
    </li>
  );
}
