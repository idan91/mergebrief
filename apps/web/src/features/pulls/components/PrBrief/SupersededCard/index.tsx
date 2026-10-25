import { useTranslation } from "react-i18next";
import { EmptyBlock } from "@web/components/EmptyBlock";
import type { SupersededStop } from "../../../types";
import { StopNoteKeys } from "./consts";

export interface SupersededCardProps {
  /** Why nothing comes after this run; absent while a newer push is on its way. */
  stop?: SupersededStop | undefined;
}

export function SupersededCard({ stop }: SupersededCardProps) {
  const { t } = useTranslation();
  if (stop !== undefined) {
    return (
      <section aria-labelledby="superseded-heading">
        <EmptyBlock
          detail={t(StopNoteKeys[stop])}
          heading={
            <h1 id="superseded-heading">
              {t("pulls.superseded.stoppedHeading")}
            </h1>
          }
        />
      </section>
    );
  }
  return (
    <section aria-labelledby="superseded-heading">
      <EmptyBlock
        busy
        detail={t("pulls.superseded.copy")}
        heading={
          <h1 id="superseded-heading">{t("pulls.superseded.heading")}</h1>
        }
      />
    </section>
  );
}
