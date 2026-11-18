import { useTranslation } from "react-i18next";

import { IconNames } from "@web/components/Icon/types";
import { readImageReferrerPolicy } from "@web/components/Markdown/media";
import { useImageFailure } from "@web/hooks/useMediaFailure";
import type { ImageStripEntry } from "../../types";
import { readTileSource } from "../../utils";
import { TilePlaceholder } from "../TilePlaceholder";
import styles from "./TileImage.module.scss";

export interface TileImageProps {
  entry: ImageStripEntry;
}

/**
 * The image's thumbnail, or the failed tile once it fails; only the
 * lightbox loads the original. The caption beneath names it, so the image
 * itself is decorative.
 */
export function TileImage({ entry }: TileImageProps) {
  const { t } = useTranslation();
  const source = readTileSource(entry);
  const { mediaRef, failed, markFailed } = useImageFailure(source);

  if (failed) {
    return (
      <TilePlaceholder
        failed
        icon={IconNames.IMAGE}
        label={t("shell.media.imageFailed")}
      />
    );
  }

  const referrerPolicy = readImageReferrerPolicy(source);
  return (
    <img
      alt=""
      className={styles["image"]}
      decoding="async"
      loading="lazy"
      ref={mediaRef}
      referrerPolicy={referrerPolicy}
      src={source}
      onError={markFailed}
    />
  );
}
