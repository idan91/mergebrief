import type { ComponentProps } from "react";
import type { ExtraProps } from "react-markdown";

import { ImageOpener } from "@web/components/ImageOpener";
import { MediaFailedRow } from "@web/components/MediaFailedRow";
import { MediaFailedRowKinds } from "@web/components/MediaFailedRow/types";
import { useImageFailure } from "@web/hooks/useMediaFailure";
import { useInsideLink, useMediaLightbox } from "../context";
import { readImageReferrerPolicy, readOutsideImageHost } from "../media";
import { dropOriginalSource, readOriginalSource } from "../original-source";
import { readLightboxMediaKey } from "./utils";

export type InlineImageProps = ComponentProps<"img"> & ExtraProps;

/**
 * The renderer's img, keeping every attribute sanitize allowed: loaded
 * lazily, and swapped for a failed row once the browser reports it cannot
 * load. The failure is tagged with its source, so new content at the same
 * place starts as an image again. An image on an outside host is never
 * loaded: the same row names its host and links it. Inside the description,
 * an image the strip holds opens the lightbox at its place, unless the
 * author linked it.
 */
export function InlineImage({
  node,
  src,
  alt,
  ...imageProps
}: InlineImageProps) {
  const { mediaRef, failed, markFailed } = useImageFailure(src);
  const originalAddress = readOriginalSource(node);
  const domAttributes = dropOriginalSource(imageProps);
  const lightbox = useMediaLightbox();
  const mediaKey = readLightboxMediaKey(lightbox, originalAddress);
  const insideLink = useInsideLink();

  const outsideHost = readOutsideImageHost(src);
  const staysUnloaded = failed || outsideHost !== undefined;

  if (staysUnloaded) {
    return (
      <MediaFailedRow
        alt={alt}
        kind={MediaFailedRowKinds.IMAGE}
        linked={insideLink}
        originalAddress={originalAddress}
        outsideHost={outsideHost}
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
      ref={mediaRef}
      referrerPolicy={referrerPolicy}
      src={src}
      onError={markFailed}
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
