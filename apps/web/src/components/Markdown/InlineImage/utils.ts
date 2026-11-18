import { buildAddressMediaKey, type MediaKey } from "brief-core/media";

import type { MediaLightboxHandle } from "../context";

/** The strip key of the address the author wrote, when the lightbox holds it; a comment image has no lightbox. */
export function readLightboxMediaKey(
  lightbox: MediaLightboxHandle | undefined,
  originalAddress: string | undefined,
): MediaKey | undefined {
  if (lightbox === undefined || originalAddress === undefined) {
    return undefined;
  }
  const key = buildAddressMediaKey(originalAddress);
  const heldByLightbox = key !== undefined && lightbox.hasMedia(key);
  return heldByLightbox ? key : undefined;
}
