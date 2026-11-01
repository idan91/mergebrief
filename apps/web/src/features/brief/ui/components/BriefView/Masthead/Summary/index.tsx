import { splitBriefSummary } from "brief-core/sanitized-markdown";
import { SummaryMediaPositions } from "brief-core/types";
import { LocalBriefKinds } from "contract";
import { useTranslation } from "react-i18next";

import { Markdown } from "@web/components/Markdown";
import { MediaLightboxScope } from "@web/components/Markdown/context";
import type { Brief } from "../../../../../model/types";
import { DeltaContext } from "../../DeltaContext";
import { MediaStrip } from "../MediaStrip";
import { useMediaGallery } from "../MediaStrip/useMediaGallery";
import { OriginalDescription } from "../OriginalDescription";
import { MediaPointer } from "./MediaPointer";
import { ShownMedia } from "./ShownMedia";
import { placeSummaryMedia } from "./utils";
import styles from "./Summary.module.scss";

export interface SummaryProps {
  brief: Brief;
}

/**
 * The brief's summary in full with its Summary Media around the lede, then
 * the description's Media, then the author's description. A Delta summary
 * shows no Summary Media.
 */
export function Summary({ brief }: SummaryProps) {
  const { t } = useTranslation();
  const delta = brief.artifactKind === LocalBriefKinds.DELTA;
  const eyebrow = delta
    ? t("brief.summarySection.eyebrowDelta")
    : t("brief.summarySection.eyebrowBrief");
  const gallery = useMediaGallery(brief);
  const placed = placeSummaryMedia(
    delta ? undefined : brief.summaryMedia,
    gallery.entries,
  );
  const prose =
    placed.afterLede.length === 0
      ? { lede: brief.summary }
      : splitBriefSummary(brief.summary);
  const openMedia = gallery.lightbox.openMedia;

  return (
    <section
      className={`${styles["summary"] ?? ""} reveal`}
      data-testid="brief-summary"
    >
      <div className={styles["eyebrow"]}>{eyebrow}</div>
      <ShownMedia
        entries={placed.beforeLede}
        position={SummaryMediaPositions.BEFORE_LEDE}
        onOpen={openMedia}
      />
      <Markdown content={prose.lede} />
      <ShownMedia
        entries={placed.afterLede}
        position={SummaryMediaPositions.AFTER_LEDE}
        onOpen={openMedia}
      />
      {prose.changelog === undefined ? null : (
        <Markdown content={prose.changelog} />
      )}
      {placed.pointer === undefined ? null : (
        <MediaPointer pointer={placed.pointer} onOpen={openMedia} />
      )}
      {delta ? <DeltaContext brief={brief} /> : null}
      <MediaStrip gallery={gallery} />
      <MediaLightboxScope value={gallery.lightbox}>
        <OriginalDescription description={brief.pr.description} />
      </MediaLightboxScope>
    </section>
  );
}
