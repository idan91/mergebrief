import { Trans, useTranslation } from "react-i18next";
import type { TFunction } from "i18next";

import type { MouseEvent } from "react";

import {
  Button,
  ButtonElements,
  ButtonSizes,
  ButtonVariants,
} from "@web/components/Button";
import { ScreenReaderOnly } from "@web/components/ScreenReaderOnly";
import type {
  LineTarget,
  SpanOwner,
} from "../../../../../model/utils/line-owner";
import styles from "./SiblingSpanHeader.module.scss";
import { type DiffSide, DiffSides } from "types/comments";

export interface SiblingSpanHeaderProps {
  owner: SpanOwner;
  /** First and last changed line the span shows, on `side`. */
  side: DiffSide;
  from: number;
  to: number;
  columnCount: number;
  jumpToLine?: ((chunkId: string, target: LineTarget) => void) | undefined;
  /** The URL that addresses a chunk, so a modified click keeps its link meaning. */
  deriveChunkUrl?: ((chunkId: string) => string) | undefined;
}

/** The full-width row that opens a sibling span: who owns the lines, and a way there. */
export function SiblingSpanHeader({
  owner,
  side,
  from,
  to,
  columnCount,
  jumpToLine,
  deriveChunkUrl,
}: SiblingSpanHeaderProps) {
  const { t } = useTranslation();
  const count = to - from + 1;
  const lines =
    count === 1 ? String(from) : t("brief.diff.siblingSpanRange", { from, to });
  const jumpName = resolveJumpName(t, owner);
  const labelKey =
    side === DiffSides.OLD
      ? "brief.diff.siblingSpanGroupRemoved"
      : "brief.diff.siblingSpanGroup";

  const jumpControl =
    jumpToLine === undefined || deriveChunkUrl === undefined ? null : (
      <Button
        as={ButtonElements.ANCHOR}
        className={styles["jump"]}
        href={deriveChunkUrl(owner.chunkId)}
        onClick={(event: MouseEvent<HTMLAnchorElement>) => {
          // A modified click keeps its link meaning (new tab, new
          // window); a plain one runs the in-app scroll to target, which finds
          // a windowed card without a page load.
          if (isModifiedClick(event)) {
            return;
          }
          event.preventDefault();
          jumpToLine(owner.chunkId, { side, line: from });
        }}
        size={ButtonSizes.SM}
        variant={ButtonVariants.QUIET}
      >
        <span aria-hidden>{t("brief.diff.siblingSpanJump")}</span>
        <ScreenReaderOnly>{jumpName}</ScreenReaderOnly>
      </Button>
    );

  return (
    <tr className={styles["header"]} data-testid="sibling-span">
      <td className={styles["cell"]} colSpan={columnCount}>
        <div className={styles["lane"]}>
          <span className={styles["label"]} data-testid="sibling-span-label">
            <Trans
              components={[
                <strong className={styles["name"]} key="group">
                  {owner.groupName}
                </strong>,
              ]}
              count={count}
              i18nKey={labelKey}
              values={{
                count,
                lines,
                index: owner.groupIndex,
                total: owner.groupCount,
              }}
            />
          </span>
          {owner.summary === undefined ? null : (
            <span className={styles["summary"]}>{owner.summary}</span>
          )}
          {jumpControl}
        </div>
      </td>
    </tr>
  );
}

function resolveJumpName(t: TFunction, owner: SpanOwner): string {
  if (owner.remainder) {
    return t("brief.diff.siblingSpanJumpRemainder");
  }

  return t("brief.diff.siblingSpanJumpGroup", { group: owner.groupName });
}

function isModifiedClick(event: MouseEvent<HTMLAnchorElement>): boolean {
  return (
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  );
}
