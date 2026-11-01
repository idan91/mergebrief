import { useEffect, useRef, useState, type ComponentProps } from "react";
import type { ExtraProps } from "react-markdown";

import { ImageOpener } from "@web/components/ImageOpener";
import { MediaFailedRow } from "@web/components/MediaFailedRow";
import { MediaFailedRowKinds } from "@web/components/MediaFailedRow/types";
import { useInsideLink, useMediaLightbox } from "../context";
import { readImageReferrerPolicy } from "../media";
import { dropOriginalSource, readOriginalSource } from "../original-source";
import { readLightboxMediaKey } from "./utils";

export type InlineImageProps = ComponentProps<"img"> & ExtraProps;

/**
 * The renderer's img, keeping every attribute sanitize allowed: loaded
 * lazily, and swapped for a failed row once the browser reports it cannot
 * load. The failure is tagged with its source, so new content at the same
 * place starts as an image again. Inside the description, an image the strip
 * holds opens the lightbox at its place, unless the author linked it.
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
  const lightbox = useMediaLightbox();
  const mediaKey = readLightboxMediaKey(lightbox, originalAddress);
  const insideLink = useInsideLink();

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

  const referrerPolicy = readImageReferrerPolicy(src);
  const image = (
    <img
      {...domAttributes}
      alt={alt}
      decoding="async"
      loading="lazy"
      ref={imageRef}
      referrerPolicy={referrerPolicy}
      src={src}
      onError={() => {
        setFailedSource(src);
      }}
    />
  );
  const opensLightbox =
    lightbox !== undefined && mediaKey !== undefined && !insideLink;
  if (!opensLightbox) {
    return image;
  }

  return (
    <ImageOpener
      alt={alt}
      onOpen={(opener) => {
        lightbox.openMedia(mediaKey, opener);
      }}
    >
      {image}
    </ImageOpener>
  );
}
