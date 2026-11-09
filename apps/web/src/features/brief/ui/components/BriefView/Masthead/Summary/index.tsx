import { splitBriefSummary } from "brief-core/sanitized-markdown";
import { SummaryMediaPositions } from "brief-core/types";
import { LocalBriefKinds } from "contract";
import { useTranslation } from "react-i18next";

import { Markdown } from "@web/components/Markdown";
import type { Brief } from "../../../../../model/types";
import { DeltaContext } from "../../DeltaContext";
import { MediaStrip } from "../MediaStrip";
import type { MediaGallery } from "../MediaStrip/types";
import { MediaPointer } from "./MediaPointer";
import { ShownMedia } from "./ShownMedia";
import { placeSummaryMedia } from "./utils";
import styles from "./Summary.module.scss";

export interface SummaryProps {
  brief: Brief;
  /** The brief's one media gallery; the masthead shares it with the description. */
  gallery: MediaGallery;
}

/**
 * The brief's summary in full with its Summary Media around the lede, then
 * the description's Media. A Delta summary shows no Summary Media and names
 * itself above the lede.
 */
export function Summary({ brief, gallery }: SummaryProps) {
  const { t } = useTranslation();
  const delta = brief.artifactKind === LocalBriefKinds.DELTA;
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
      {delta ? (
        <div className={styles["eyebrow"]}>
          {t("brief.summarySection.eyebrowDelta")}
        </div>
      ) : null}
      <ShownMedia
        entries={placed.beforeLede}
        position={SummaryMediaPositions.BEFORE_LEDE}
        onOpen={openMedia}
      />
      <div className={styles["prose"]}>
        <Markdown content={prose.lede} />
      </div>
      <ShownMedia
        entries={placed.afterLede}
        position={SummaryMediaPositions.AFTER_LEDE}
        onOpen={openMedia}
      />
      {prose.changelog === undefined ? null : (
        <div className={styles["prose"]}>
          <Markdown content={prose.changelog} />
        </div>
      )}
      {placed.pointer === undefined ? null : (
        <MediaPointer pointer={placed.pointer} onOpen={openMedia} />
      )}
      {delta ? <DeltaContext brief={brief} /> : null}
      <MediaStrip gallery={gallery} />
    </section>
  );
}
