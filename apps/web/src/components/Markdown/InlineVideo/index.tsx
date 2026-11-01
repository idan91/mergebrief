import { useEffect, useRef, useState, type ComponentProps } from "react";
import type { ExtraProps } from "react-markdown";

import { MediaFailedRow } from "@web/components/MediaFailedRow";
import { MediaFailedRowKinds } from "@web/components/MediaFailedRow/types";
import { readOriginalSource } from "../original-source";
import styles from "./InlineVideo.module.scss";

export type InlineVideoProps = ComponentProps<"video"> & ExtraProps;

/**
 * The renderer's video: a player with controls that fetches only its
 * metadata and never plays on its own, swapped for a failed row once the
 * browser reports it cannot load. No `crossorigin`: the proxy is
 * same-origin, and the signed host behind it sends no CORS header.
 */
export function InlineVideo({ node, src, width, height }: InlineVideoProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [failedSource, setFailedSource] = useState<string | undefined>();
  const originalAddress = readOriginalSource(node);

  // A server-rendered video can fail before hydration attaches onError;
  // the element keeps the error it already raised.
  useEffect(() => {
    if (videoRef.current?.error?.code !== undefined) {
      setFailedSource(src);
    }
  }, [src]);

  if (src !== undefined && failedSource === src) {
    return (
      <MediaFailedRow
        kind={MediaFailedRowKinds.VIDEO}
        originalAddress={originalAddress}
      />
    );
  }

  return (
    // oxlint-disable-next-line jsx-a11y/media-has-caption -- a recording pasted into a PR comes with no caption file to point a track at
    <video
      className={styles["video"]}
      controls
      height={height}
      playsInline
      preload="metadata"
      ref={videoRef}
      src={src}
      width={width}
      onError={() => {
        setFailedSource(src);
      }}
    />
  );
}
