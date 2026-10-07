import { useTranslation } from "react-i18next";

import type { BriefViewModel } from "@web/features/brief/utils";
import type { CarriedItem } from "@web/features/review/utils";
import { AttentionList } from "./AttentionList";
import styles from "./CarryOver.module.scss";
import { useCarryOver } from "./useCarryOver";
import { getSpanLabel } from "./utils";

export interface CarryOverProps {
  model: BriefViewModel;
  /** This Brief's head, the far end of the span the row states. */
  headSha: string;
  jumpToItem: (item: CarriedItem) => void;
}

/**
 * The carry-over row: a one-line receipt once nothing needs a re-look, and
 * the verdict over the attention list while carried items still do.
 *
 * No dismiss control. Silent carry-over is invisible, and an unseen carry
 * gets re-checked by hand, which is the exact cost the carry-over removes.
 */
export function CarryOver({ model, headSha, jumpToItem }: CarryOverProps) {
  const { t } = useTranslation();
  const view = useCarryOver({ model, jumpToItem });

  if (view === null) {
    return null;
  }

  const pending = view.items.length > 0;
  const verdict = pending
    ? t("brief.carryOver.pending", { count: view.items.length })
    : t("brief.carryOver.clean");
  const receipt = t("brief.carryOver.receipt", {
    count: view.carriedFrom.items,
    span: getSpanLabel(
      t,
      view.carriedFrom.headSha,
      headSha,
      view.carriedFrom.revisions,
    ),
    verdict,
  });
  const statusText = pending ? verdict : receipt;

  return (
    <aside
      aria-label={t("brief.carryOver.regionLabel")}
      className={styles["row"]}
      data-state={pending ? "pending" : "clean"}
      data-testid="carry-over-row"
    >
      {/* One live region across both states, so the last cleared item
          announces the receipt it lands on. */}
      <p className={styles["summary"]} role="status">
        {statusText}
      </p>

      {pending ? (
        <AttentionList
          armedDraftId={view.armedDraftId}
          items={view.items}
          jumpToItem={jumpToItem}
          label={verdict}
          runAction={view.runAction}
        />
      ) : null}
    </aside>
  );
}
