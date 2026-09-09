import { useId } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@web/components/Button/Button";
import type { CarriedItem } from "@web/features/review/utils";
import styles from "./AttentionList.module.scss";
import {
  getActionCopyKey,
  getKindCopyKey,
  getRunnableActions,
  type AttentionActionId,
} from "./utils";

export interface AttentionListProps {
  items: CarriedItem[];
  /** The draft waiting for its new home; its control reads as armed. */
  armedDraftId: string | null;
  /** Jumps to the item's location, which is the submit list's own mechanic. */
  jumpToItem: (item: CarriedItem) => void;
  runAction: (item: CarriedItem, action: AttentionActionId) => void;
}

/**
 * The carried items still needing a re-look. Each row states what happened,
 * where, and offers exactly the operations the server said would clear it.
 */
export function AttentionList({
  items,
  armedDraftId,
  jumpToItem,
  runAction,
}: AttentionListProps) {
  const { t } = useTranslation();
  const noteId = useId();

  return (
    <ul aria-label={t("brief.carryOver.listLabel")} className={styles["list"]}>
      {items.map((item, index) => {
        const itemNoteId = `${noteId}-${String(index)}`;
        const armed = armedDraftId === item.actionTargetId;
        return (
          <li
            className={styles["item"]}
            data-testid="attention-item"
            key={item.id}
          >
            <span className={styles["kind"]}>{t(getKindCopyKey(item))}</span>
            <Button
              className={styles["location"]}
              data-testid="attention-jump"
              disabled={item.unplaceable}
              onClick={() => jumpToItem(item)}
              size="sm"
              variant="quiet"
            >
              {item.label}
            </Button>
            <span className={styles["actions"]}>
              {getRunnableActions(item).map((action) => (
                <Button
                  aria-describedby={item.unplaceable ? itemNoteId : undefined}
                  aria-pressed={
                    action === "reanchor-draft-comment" ? armed : undefined
                  }
                  data-testid={`attention-action-${action}`}
                  disabled={
                    item.unplaceable && action !== "delete-draft-comment"
                  }
                  key={action}
                  onClick={() => runAction(item, action)}
                  size="sm"
                  variant="secondary"
                >
                  {t(getActionCopyKey(action, armed))}
                </Button>
              ))}
            </span>
            {armed ? (
              <p className={styles["note"]}>
                {t("brief.carryOver.reanchorHint")}
              </p>
            ) : null}
            {item.unplaceable ? (
              <p className={styles["note"]} id={itemNoteId}>
                {t("brief.carryOver.fileGone")}
              </p>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
