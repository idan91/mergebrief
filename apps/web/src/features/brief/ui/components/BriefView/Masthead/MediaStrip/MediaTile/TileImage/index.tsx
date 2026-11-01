import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { IconNames } from "@web/components/Icon/types";
import { readImageReferrerPolicy } from "@web/components/Markdown/media";
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
  const imageRef = useRef<HTMLImageElement>(null);
  const [failedSource, setFailedSource] = useState<string>();
  const source = readTileSource(entry);
  const failed = failedSource === source;

  // A server-rendered image can fail before hydration attaches onError;
  // decode() on a settled image rejects only when it is broken.
  useEffect(() => {
    if (failed) {
      return;
    }
    const image = imageRef.current;
    if (image === null || !image.complete) {
      return;
    }
    image.decode().catch(() => {
      setFailedSource(source);
    });
  }, [failed, source]);

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
      ref={imageRef}
      referrerPolicy={referrerPolicy}
      src={source}
      onError={() => {
        setFailedSource(source);
      }}
    />
  );
}
