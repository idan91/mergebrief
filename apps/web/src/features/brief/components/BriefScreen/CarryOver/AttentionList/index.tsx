import { useId } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@web/components/Button";
import { LinkButton } from "@web/components/LinkButton";
import type { CarriedItem } from "@web/features/review/utils";
import { RiskBadge } from "../../RiskBadge";
import styles from "./AttentionList.module.scss";
import {
  getActionCopyKey,
  getKindCopy,
  getRunnableActions,
  type AttentionActionId,
} from "./utils";

export interface AttentionListProps {
  items: CarriedItem[];
  /** The verdict the list stands in for; its accessible name. */
  label: string;
  /** The draft waiting for its new home; its control reads as armed. */
  armedDraftId: string | null;
  /** Jumps to the item's location, which is the submit list's own mechanic. */
  jumpToItem: (item: CarriedItem) => void;
  runAction: (item: CarriedItem, action: AttentionActionId) => void;
}

interface AttentionRowProps extends Omit<
  AttentionListProps,
  "items" | "label"
> {
  item: CarriedItem;
}

function AttentionRow({
  item,
  armedDraftId,
  jumpToItem,
  runAction,
}: AttentionRowProps) {
  const { t } = useTranslation();
  const hintId = useId();
  const armed = armedDraftId === item.actionTargetId;
  const copy = getKindCopy(item);
  const hint = item.unplaceable ? t("brief.carryOver.fileGone") : t(copy.hint);

  return (
    <li
      className={styles["item"]}
      data-armed={armed ? "" : undefined}
      data-testid="attention-item"
    >
      <div className={styles["body"]}>
        <span className={styles["kind"]}>{t(copy.title)}</span>
        <span className={styles["where"]}>
          {item.attribute === undefined ? null : (
            <RiskBadge>{item.attribute}</RiskBadge>
          )}
          <LinkButton
            className={styles["location"]}
            data-testid="attention-jump"
            disabled={item.unplaceable}
            onClick={() => jumpToItem(item)}
          >
            {item.locationLabel}
          </LinkButton>
        </span>
        <p className={styles["hint"]} id={hintId}>
          {hint}
        </p>
      </div>
      <span className={styles["actions"]}>
        {getRunnableActions(item).map((action) => (
          <Button
            aria-describedby={hintId}
            data-testid={`attention-action-${action}`}
            disabled={item.unplaceable && action !== "delete-draft-comment"}
            key={action}
            onClick={() => runAction(item, action)}
            size="sm"
            variant="secondary"
          >
            {t(getActionCopyKey(action, armed))}
          </Button>
        ))}
      </span>
    </li>
  );
}

/**
 * The carried items still needing a re-look. Each row states what happened,
 * where, what clears it, and offers exactly the operations the server said
 * would.
 */
export function AttentionList({
  items,
  label,
  ...rowProps
}: AttentionListProps) {
  return (
    <ul aria-label={label} className={styles["list"]}>
      {items.map((item) => (
        <AttentionRow item={item} key={item.id} {...rowProps} />
      ))}
    </ul>
  );
}
