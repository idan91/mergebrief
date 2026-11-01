import { useEffect, useRef, useState, type ComponentProps } from "react";
import type { ExtraProps } from "react-markdown";

import { MediaFailedRow } from "../MediaFailedRow";
import { MediaFailedRowKinds } from "../MediaFailedRow/types";
import { dropOriginalSource, readOriginalSource } from "../original-source";

export type InlineImageProps = ComponentProps<"img"> & ExtraProps;

/**
 * The renderer's img, keeping every attribute sanitize allowed: loaded
 * lazily, and swapped for a failed row once the browser reports it cannot
 * load. The failure is tagged with its source, so new content at the same
 * place starts as an image again.
 */
export function InlineImage({
  node,
  src,
  alt,
  ...imageProps
}: InlineImageProps) {
  const imageRef = useRef<HTMLImageElement>(null);
  const [failedSource, setFailedSource] = useState<string | undefined>();
  const originalAddress = readOriginalSource(node);
  const domAttributes = dropOriginalSource(imageProps);

  // A server-rendered image can fail before hydration attaches onError;
  // decode() on a settled image rejects only when it is broken.
  useEffect(() => {
    const image = imageRef.current;
    if (image === null || !image.complete) {
      return;
    }
    image.decode().catch(() => {
      setFailedSource(src);
    });
  }, [src]);

  if (src !== undefined && failedSource === src) {
    return (
      <MediaFailedRow
        alt={alt}
        kind={MediaFailedRowKinds.IMAGE}
        originalAddress={originalAddress}
      />
    );
  }

  return (
    <img
      {...domAttributes}
      alt={alt}
      decoding="async"
      loading="lazy"
      ref={imageRef}
      src={src}
      onError={() => {
        setFailedSource(src);
      }}
    />
  );
}
