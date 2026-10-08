import type { RefObject } from "react";
import type { TFunction } from "i18next";
import type { TranslationKey } from "i18n";
import { useTranslation } from "react-i18next";
import clsx from "clsx";

import { Button } from "@web/components/Button";
import { RowButton } from "@web/components/RowButton";
import modalStyles from "@web/components/Modal/Modal.module.scss";
import { type UnresolvedItem } from "../../utils/state";
import { UnresolvedItemKinds } from "../../utils/types";
import styles from "./SubmitModal.module.scss";

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
      <h2 id="submit-modal-heading" ref={headingRef} tabIndex={-1}>
        {t("review.submit.beforeYouSubmit")}
      </h2>
      <p className={modalStyles["copy"]}>{t("review.submit.advisoryIntro")}</p>
      <div className={modalStyles["unresolvedList"]}>
        {items.map((item) => (
          <RowButton
            key={item.id}
            variant="card"
            onClick={() => jumpToItem(item)}
          >
            <span>{unresolvedKindLabel(t, item.kind)}</span>
            <b>{item.label}</b>
          </RowButton>
        ))}
      </div>
      <p className={styles["hint"]}>{t("review.submit.jumpClosesDialog")}</p>
      <div className={clsx(modalStyles["actions"], styles["actionsRow"])}>
        <Button onClick={close}>{t("review.submit.keepReviewing")}</Button>
        <Button variant="accent" onClick={continueToVerdict}>
          {t("review.submit.continueAction")}
        </Button>
      </div>
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
