import { LocalBriefKinds } from "contract";
import { useTranslation } from "react-i18next";

import { Markdown } from "@web/components/Markdown";
import { MediaLightboxScope } from "@web/components/Markdown/context";
import type { Brief } from "../../../../../model/types";
import { DeltaContext } from "../../DeltaContext";
import { MediaStrip } from "../MediaStrip";
import { useMediaGallery } from "../MediaStrip/useMediaGallery";
import { OriginalDescription } from "../OriginalDescription";
import styles from "./Summary.module.scss";

export interface SummaryProps {
  brief: Brief;
}

/** The brief's summary in full, then the description's Media, then the author's description. */
export function Summary({ brief }: SummaryProps) {
  const { t } = useTranslation();
  const delta = brief.artifactKind === LocalBriefKinds.DELTA;
  const eyebrow = delta
    ? t("brief.summarySection.eyebrowDelta")
    : t("brief.summarySection.eyebrowBrief");
  const gallery = useMediaGallery(brief);

  return (
    <section
      className={`${styles["summary"] ?? ""} reveal`}
      data-testid="brief-summary"
    >
      <div className={styles["eyebrow"]}>{eyebrow}</div>
      <Markdown content={brief.summary} />
      {delta ? <DeltaContext brief={brief} /> : null}
      <MediaStrip gallery={gallery} />
      <MediaLightboxScope value={gallery.lightbox}>
        <OriginalDescription description={brief.pr.description} />
      </MediaLightboxScope>
    </section>
  );
}
