import { MediaKinds } from "brief-core/media";
import { useState } from "react";

import { readImageReferrerPolicy } from "@web/components/Markdown/media";
import type { ImageStripEntry } from "../../../types";
import type { DisplaySize } from "../../types";
import { LightboxFailed } from "../LightboxFailed";
import { LightboxZoom } from "../LightboxZoom";
import { readImageNaturalSize } from "./utils";
import styles from "./LightboxImage.module.scss";

export interface LightboxImageProps {
  entry: ImageStripEntry;
}

/**
 * The original image, fitted to the stage. Actual size is its natural
 * pixels as CSS pixels, offered only when that is larger than the fit.
 */
export function LightboxImage({ entry }: LightboxImageProps) {
  const [naturalSize, setNaturalSize] = useState<DisplaySize>();
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <LightboxFailed githubLink={entry.githubLink} kind={MediaKinds.IMAGE} />
    );
  }

  const referrerPolicy = readImageReferrerPolicy(entry.source);
  return (
    <LightboxZoom naturalSize={naturalSize}>
      <img
        alt={entry.alt ?? ""}
        className={styles["image"]}
        decoding="async"
        referrerPolicy={referrerPolicy}
        src={entry.source}
        onError={() => {
          setFailed(true);
        }}
        onLoad={(event) => {
          setNaturalSize(readImageNaturalSize(event.currentTarget));
        }}
      />
    </LightboxZoom>
  );
}
