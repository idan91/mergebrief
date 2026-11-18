import { ImageOpener } from "@web/components/ImageOpener";
import type { MediaLightboxHandle } from "@web/components/Markdown/context";
import { readImageReferrerPolicy } from "@web/components/Markdown/media";
import { MediaFailedRow } from "@web/components/MediaFailedRow";
import { MediaFailedRowKinds } from "@web/components/MediaFailedRow/types";
import { useImageFailure } from "@web/hooks/useMediaFailure";
import type { ImageStripEntry } from "../../../MediaStrip/types";
import styles from "./ShownImage.module.scss";

export interface ShownImageProps {
  entry: ImageStripEntry;
  onOpen: MediaLightboxHandle["openMedia"];
}

/** A shown image at a capped height that opens the lightbox at its place, or the failed row. */
export function ShownImage({ entry, onOpen }: ShownImageProps) {
  const { mediaRef, failed, markFailed } = useImageFailure(entry.source);

  if (failed) {
    return (
      <MediaFailedRow
        alt={entry.alt}
        kind={MediaFailedRowKinds.IMAGE}
        originalAddress={entry.githubLink}
      />
    );
  }

  const referrerPolicy = readImageReferrerPolicy(entry.source);
  const openerName = entry.alt ?? entry.caption;
  return (
    <ImageOpener
      alt={openerName}
      onOpen={(opener) => {
        onOpen(entry.key, opener);
      }}
    >
      <img
        alt={entry.alt ?? ""}
        className={styles["image"]}
        decoding="async"
        loading="lazy"
        ref={mediaRef}
        referrerPolicy={referrerPolicy}
        src={entry.source}
        onError={markFailed}
      />
    </ImageOpener>
  );
}
