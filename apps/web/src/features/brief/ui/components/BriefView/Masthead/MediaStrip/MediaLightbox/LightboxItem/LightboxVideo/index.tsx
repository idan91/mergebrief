import { MediaKinds } from "brief-core/media";
import { useState } from "react";

import type { VideoStripEntry } from "../../../types";
import { LightboxFailed } from "../LightboxFailed";
import styles from "./LightboxVideo.module.scss";

export interface LightboxVideoProps {
  entry: VideoStripEntry;
}

/**
 * The same player the text uses: controls, metadata only, never playing on
 * its own, and no `crossorigin`, since the signed host behind the proxy
 * sends no CORS header.
 */
export function LightboxVideo({ entry }: LightboxVideoProps) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <LightboxFailed githubLink={entry.githubLink} kind={MediaKinds.VIDEO} />
    );
  }

  return (
    // oxlint-disable-next-line jsx-a11y/media-has-caption -- a recording pasted into a PR comes with no caption file to point a track at
    <video
      className={styles["video"]}
      controls
      playsInline
      preload="metadata"
      src={entry.source}
      onError={() => {
        setFailed(true);
      }}
    />
  );
}
