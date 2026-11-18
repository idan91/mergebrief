import type { ComponentProps } from "react";
import type { ExtraProps } from "react-markdown";

import { MediaFailedRow } from "@web/components/MediaFailedRow";
import { MediaFailedRowKinds } from "@web/components/MediaFailedRow/types";
import { MediaPlayer } from "@web/components/MediaPlayer";
import { useVideoFailure } from "@web/hooks/useMediaFailure";
import { readOriginalSource } from "../original-source";
import styles from "./InlineVideo.module.scss";

export type InlineVideoProps = ComponentProps<"video"> & ExtraProps;

/** The renderer's video: the shared player, swapped for a failed row once the browser reports it cannot load. */
export function InlineVideo({ node, src, width, height }: InlineVideoProps) {
  const { mediaRef, failed, markFailed } = useVideoFailure(src);
  const originalAddress = readOriginalSource(node);

  if (failed) {
    return (
      <MediaFailedRow
        kind={MediaFailedRowKinds.VIDEO}
        originalAddress={originalAddress}
      />
    );
  }

  return (
    <MediaPlayer
      className={styles["video"]}
      height={height}
      playerRef={mediaRef}
      source={src}
      width={width}
      onError={markFailed}
    />
  );
}
