import { buildAddressMediaKey } from "brief-core/media";
import { describe, expect, it } from "vitest";

import {
  COMMITTED_IMAGE_NORMALISED_URL,
  COMMITTED_IMAGE_URL,
} from "@web/test/attachments";
import type { MediaLightboxHandle } from "../context";
import { readLightboxMediaKey } from "./utils";

function stubLightbox(addresses: readonly string[]): MediaLightboxHandle {
  const keys = new Set(
    addresses.map((address) => buildAddressMediaKey(address)),
  );
  return { hasMedia: (key) => keys.has(key), openMedia: () => {} };
}

describe("readLightboxMediaKey", () => {
  it("matches any written form of an address by its normalised key", () => {
    const lightbox = stubLightbox([COMMITTED_IMAGE_NORMALISED_URL]);

    expect(readLightboxMediaKey(lightbox, COMMITTED_IMAGE_URL)).toBe(
      COMMITTED_IMAGE_NORMALISED_URL,
    );
  });

  it("gives no key outside the description or for an image not in the strip", () => {
    const lightbox = stubLightbox([COMMITTED_IMAGE_URL]);

    expect(
      readLightboxMediaKey(undefined, COMMITTED_IMAGE_URL),
    ).toBeUndefined();
    expect(
      readLightboxMediaKey(lightbox, "https://example.com/other.png"),
    ).toBeUndefined();
    expect(readLightboxMediaKey(lightbox, undefined)).toBeUndefined();
  });
});
