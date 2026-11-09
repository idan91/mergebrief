import type { RefObject } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@web/components/Button";
import { Modal } from "@web/components/Modal";
import modalStyles from "@web/components/Modal/Modal.module.scss";
import { type UnresolvedItem } from "../../utils/state";
import { buildAdvisoryGroups } from "./utils";

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
  const groups = buildAdvisoryGroups(t, items);

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
        {groups.map((group) => (
          <Modal.UnresolvedGroup
            count={group.count}
            heading={group.heading}
            key={group.kind}
          >
            {group.rows.map(({ item, kindLabel }) => (
              <Modal.UnresolvedRow
                key={item.id}
                kindLabel={kindLabel}
                path={item.label}
                riskLabel={item.riskAttribute}
                onClick={() => jumpToItem(item)}
              />
            ))}
          </Modal.UnresolvedGroup>
        ))}
      </div>
      <Modal.Footer>
        <Button onClick={close}>{t("review.submit.keepReviewing")}</Button>
        <Button variant="primary" onClick={continueToVerdict}>
          {t("review.submit.continueAction")}
        </Button>
      </Modal.Footer>
    </>
  );
}
