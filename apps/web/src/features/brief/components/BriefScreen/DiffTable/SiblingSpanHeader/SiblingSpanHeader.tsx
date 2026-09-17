import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";

import type { MouseEvent } from "react";

import {
  Button,
  ButtonElements,
  ButtonSizes,
  ButtonVariants,
} from "@web/components/Button/Button";
import { deriveChunkHash } from "../../utils";
import { ScreenReaderOnly } from "@web/components/ScreenReaderOnly/ScreenReaderOnly";
import type { LineSide } from "@web/components/DiffRows/types";
import type { LineTarget, SpanOwner } from "../../../../utils/lineOwner";
import styles from "./SiblingSpanHeader.module.scss";

export interface SiblingSpanHeaderProps {
  owner: SpanOwner;
  /** First and last changed line the span shows, on `side`. */
  side: LineSide;
  from: number;
  to: number;
  columnCount: number;
  jumpToLine?: ((chunkId: string, target: LineTarget) => void) | undefined;
}

/** The full-width row that opens a sibling span: who owns the lines, and a way there. */
export function SiblingSpanHeader({
  owner,
  side,
  from,
  to,
  columnCount,
  jumpToLine,
}: SiblingSpanHeaderProps) {
  const { t } = useTranslation();
  const label = resolveSpanLabel(t, owner, side, from, to);
  const jumpName = resolveJumpName(t, owner);

  return (
    <tr className={styles["header"]} data-testid="sibling-span">
      <td className={styles["cell"]} colSpan={columnCount}>
        <div className={styles["lane"]}>
          <span className={styles["label"]} data-testid="sibling-span-label">
            {label}
          </span>
          {owner.summary === undefined ? null : (
            <span className={styles["summary"]}>{owner.summary}</span>
          )}
          {jumpToLine === undefined ? null : (
            <Button
              as={ButtonElements.ANCHOR}
              className={styles["jump"]}
              href={deriveChunkHash(owner.chunkId)}
              onClick={(event: MouseEvent<HTMLAnchorElement>) => {
                // A modified click keeps its link meaning (new tab, new
                // window); a plain one runs the in-app landing, which finds
                // a windowed card the browser's own hash scroll cannot.
                if (isModifiedClick(event)) return;
                event.preventDefault();
                jumpToLine(owner.chunkId, { side, line: from });
              }}
              size={ButtonSizes.SM}
              variant={ButtonVariants.QUIET}
            >
              <span aria-hidden>{t("brief.diff.siblingSpanJump")}</span>
              <ScreenReaderOnly>{jumpName}</ScreenReaderOnly>
            </Button>
          )}
        </div>
      </td>
    </tr>
  );
}

/** A span that only deletes is numbered on the old side, and the copy says so. */
function resolveSpanLabel(
  t: TFunction,
  owner: SpanOwner,
  side: LineSide,
  from: number,
  to: number,
): string {
  const count = to - from + 1;
  const lines =
    count === 1 ? String(from) : t("brief.diff.siblingSpanRange", { from, to });
  const group = owner.groupName;
  if (owner.remainder) {
    return side === "old"
      ? t("brief.diff.siblingSpanRemainderRemoved", { count, lines })
      : t("brief.diff.siblingSpanRemainder", { count, lines });
  }

  return side === "old"
    ? t("brief.diff.siblingSpanGroupRemoved", { count, lines, group })
    : t("brief.diff.siblingSpanGroup", { count, lines, group });
}

/** The control's accessible name; it starts with the visible label. */
function resolveJumpName(t: TFunction, owner: SpanOwner): string {
  if (owner.remainder) return t("brief.diff.siblingSpanJumpRemainder");

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
