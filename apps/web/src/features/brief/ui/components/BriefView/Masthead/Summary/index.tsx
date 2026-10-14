import { LocalBriefKinds } from "contract";
import { useTranslation } from "react-i18next";

import { Markdown } from "@web/components/Markdown";
import type { Brief } from "../../../../../model/types";
import { DeltaContext } from "../../DeltaContext";
import { OriginalDescription } from "../OriginalDescription";
import styles from "./Summary.module.scss";

export interface SummaryProps {
  brief: Brief;
}

/** The brief's summary in full, with the author's description attached beneath. */
export function Summary({ brief }: SummaryProps) {
  const { t } = useTranslation();
  const delta = brief.artifactKind === LocalBriefKinds.DELTA;
  const eyebrow = delta
    ? t("brief.summarySection.eyebrowDelta")
    : t("brief.summarySection.eyebrowBrief");

  return (
    <section
      className={`${styles["summary"] ?? ""} reveal`}
      data-testid="brief-summary"
    >
      <div className={styles["eyebrow"]}>{eyebrow}</div>
      <Markdown content={brief.summary} />
      {delta ? <DeltaContext brief={brief} /> : null}
      <OriginalDescription description={brief.pr.description} />
    </section>
  );
}
