import { MediaFailedRow } from "@web/components/MediaFailedRow";
import { MediaFailedRowKinds } from "@web/components/MediaFailedRow/types";
import { MediaPlayer } from "@web/components/MediaPlayer";
import { useVideoFailure } from "@web/hooks/useMediaFailure";
import type { VideoStripEntry } from "../../../MediaStrip/types";
import styles from "./ShownVideo.module.scss";

export interface ShownVideoProps {
  entry: VideoStripEntry;
}

/** The shared player at the shown cap, or the failed row once the browser reports it cannot load. */
export function ShownVideo({ entry }: ShownVideoProps) {
  const { mediaRef, failed, markFailed } = useVideoFailure(entry.source);

  if (failed) {
    return (
      <MediaFailedRow
        kind={MediaFailedRowKinds.VIDEO}
        originalAddress={entry.githubLink}
      />
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
