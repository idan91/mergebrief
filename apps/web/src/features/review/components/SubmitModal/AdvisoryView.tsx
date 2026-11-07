import type { RefObject } from "react";
import type { TFunction } from "i18next";
import type { TranslationKey } from "i18n";
import { useTranslation } from "react-i18next";

import { BreakablePath } from "@web/components/BreakablePath";
import { Button } from "@web/components/Button";
import { Modal } from "@web/components/Modal";
import { RowButton } from "@web/components/RowButton";
import rowButtonStyles from "@web/components/RowButton/RowButton.module.scss";
import { type UnresolvedItem } from "../../utils/state";
import { UnresolvedItemKinds } from "../../utils/types";
import styles from "./SubmitModal.module.scss";
import modalStyles from "@web/components/Modal/Modal.module.scss";

export interface AdvisoryViewProps {
  headingRef: RefObject<HTMLHeadingElement | null>;
  items: readonly UnresolvedItem[];
  jumpToItem: (item: UnresolvedItem) => void;
  close: () => void;
  continueToVerdict: () => void;
}

export function AdvisoryView({
  headingRef,
  items,
  jumpToItem,
  close,
  continueToVerdict,
}: AdvisoryViewProps) {
  const { t } = useTranslation();
  return (
    <>
      <Modal.Header
        close={close}
        detail={
          <>
            {t("review.submit.advisoryIntro")}{" "}
            {t("review.submit.jumpClosesDialog")}
          </>
        }
        headingRef={headingRef}
        id="submit-modal-heading"
        title={t("review.submit.beforeYouSubmit")}
      />
      <div className={modalStyles["unresolvedList"]}>
        {items.map((item) => (
          <RowButton
            key={item.id}
            variant="card"
            onClick={() => jumpToItem(item)}
          >
            <span className={rowButtonStyles["cardEyebrow"]}>
              {unresolvedKindLabel(t, item.kind)}
            </span>
            <b>
              {item.riskAttribute === undefined ? null : (
                <span className={styles["riskAttribute"]}>
                  {item.riskAttribute}
                  {" @ "}
                </span>
              )}
              <BreakablePath path={item.label} />
            </b>
          </RowButton>
        ))}
      </div>
      <Modal.Footer>
        <Button onClick={close}>{t("review.submit.keepReviewing")}</Button>
        <Button variant="accent" onClick={continueToVerdict}>
          {t("review.submit.continueAction")}
        </Button>
      </Modal.Footer>
    </>
  );
}

function unresolvedKindLabel(
  t: TFunction,
  kind: UnresolvedItem["kind"],
): string {
  const keys: Record<UnresolvedItem["kind"], TranslationKey> = {
    [UnresolvedItemKinds.OPEN_RISK]: "review.submit.blockerOpenRisk",
    [UnresolvedItemKinds.MISSING_EVIDENCE]:
      "review.submit.blockerMissingEvidence",
    [UnresolvedItemKinds.UNREVIEWED_CORE]:
      "review.submit.blockerUnreviewedCore",
    [UnresolvedItemKinds.UNREVIEWED_REMAINDER]:
      "review.submit.blockerUnreviewedRemainder",
    [UnresolvedItemKinds.DRAFT_COMMENT]: "review.submit.blockerDraftComment",
    [UnresolvedItemKinds.THIN_DISMISSAL]: "review.submit.blockerThinDismissal",
  };
  return t(keys[kind]);
}
