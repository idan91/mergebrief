import type { RefObject } from "react";

export interface MediaPlayerProps {
  source: string | undefined;
  playerRef: RefObject<HTMLVideoElement | null>;
  onError: () => void;
  className?: string | undefined;
  width?: number | string | undefined;
  height?: number | string | undefined;
}

/**
 * The one video player every Media surface draws: controls shown, only the
 * metadata fetched, never playing on its own. No `crossorigin`: the proxy is
 * same-origin, and the signed host behind it sends no CORS header.
 */
export function MediaPlayer({
  source,
  playerRef,
  onError,
  className,
  width,
  height,
}: MediaPlayerProps) {
  return (
    // oxlint-disable-next-line jsx-a11y/media-has-caption -- a recording pasted into a PR comes with no caption file to point a track at
    <video
      className={className}
      controls
      height={height}
      playsInline
      preload="metadata"
      ref={playerRef}
      src={source}
      width={width}
      onError={onError}
    />
  );
}
