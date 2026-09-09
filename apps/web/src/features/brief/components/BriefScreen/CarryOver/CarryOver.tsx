import { useTranslation } from "react-i18next";

import type { BriefViewModel } from "@web/features/brief/utils";
import type { ReviewSessionPayload } from "@web/features/review/session";
import type { CarriedItem } from "@web/features/review/utils";
import { AttentionList } from "./AttentionList/AttentionList";
import styles from "./CarryOver.module.scss";
import { useCarryOver } from "./useCarryOver";
import { getSpanLabel } from "./utils";

export interface CarryOverProps {
  /** The session read. No `carriedFrom` = a first-ever session, no row. */
  session: ReviewSessionPayload;
  model: BriefViewModel;
  /** This Brief's head, the far end of the span the row states. */
  headSha: string;
  jumpToItem: (item: CarriedItem) => void;
}

/**
 * The carry-over row: a receipt for work that moved with this revision, and
 * the attention list in its place while carried items still need a re-look.
 *
 * No dismiss control. Silent carry-over is invisible, and an unseen carry
 * gets re-checked by hand, which is the exact cost the carry-over removes.
 */
export function CarryOver({
  session,
  model,
  headSha,
  jumpToItem,
}: CarryOverProps) {
  const { t } = useTranslation();
  const view = useCarryOver({ session, model, jumpToItem });

  if (view === null) return null;

  // Every state says the same three things; only the verdict changes, and it
  // never becomes "nothing", because the last cleared item lands back on it.
  const getVerdict = (): string => {
    if (view.items.length === 0) return t("brief.carryOver.clean");
    return t("brief.carryOver.pending", { count: view.items.length });
  };

  return (
    <aside
      aria-label={t("brief.carryOver.regionLabel")}
      className={styles["row"]}
      data-state={view.items.length > 0 ? "pending" : "clean"}
      data-testid="carry-over-row"
    >
      {/* Live: the last cleared item turns the list back into the receipt,
        and a reviewer who cleared it from the diff never saw this region. */}
      <p className={styles["summary"]} role="status">
        {t("brief.carryOver.receipt", {
          count: view.carriedFrom.items,
          span: getSpanLabel(
            t,
            view.carriedFrom.headSha,
            headSha,
            view.carriedFrom.revisions,
          ),
          verdict: getVerdict(),
        })}
      </p>

      {view.items.length > 0 ? (
        <AttentionList
          armedDraftId={view.armedDraftId}
          items={view.items}
          jumpToItem={jumpToItem}
          runAction={view.runAction}
        />
      ) : null}
    </aside>
  );
}
