import { MediaKinds } from "brief-core/media";

import { MediaPlayer } from "@web/components/MediaPlayer";
import { useVideoFailure } from "@web/hooks/useMediaFailure";
import type { VideoStripEntry } from "../../../types";
import { LightboxFailed } from "../LightboxFailed";
import styles from "./LightboxVideo.module.scss";

export interface LightboxVideoProps {
  entry: VideoStripEntry;
}

/** The shared player fitted to the stage, or the failed panel once it cannot load. */
export function LightboxVideo({ entry }: LightboxVideoProps) {
  const { mediaRef, failed, markFailed } = useVideoFailure(entry.source);

  if (failed) {
    return (
      <LightboxFailed githubLink={entry.githubLink} kind={MediaKinds.VIDEO} />
    );
  }

  return (
    <MediaPlayer
      className={styles["video"]}
      playerRef={mediaRef}
      source={entry.source}
      onError={markFailed}
    />
  );
}
