import { createIsomorphicFn } from "@tanstack/react-start";

import { PRODUCT_NAME } from "../../components/Header/consts";
import { getServerEnv } from "../../server/env";

const SHARE_IMAGE_PATH = "/og-image.png";
const SHARE_IMAGE_WIDTH = "1200";
const SHARE_IMAGE_HEIGHT = "630";

interface OpenGraphTag {
  readonly property: string;
  readonly content: string;
}

interface TwitterTag {
  readonly name: string;
  readonly content: string;
}

export type ShareMetaTag = OpenGraphTag | TwitterTag;

/** The share image as the absolute URL link-preview crawlers require; absent without a usable origin. */
export function buildShareImageUrl(
  origin: string | undefined,
): string | undefined {
  if (origin === undefined || !URL.canParse(SHARE_IMAGE_PATH, origin)) {
    return undefined;
  }

  return new URL(SHARE_IMAGE_PATH, origin).href;
}

/** The card tags: the large-image card when the image has an absolute URL, the plain card when it does not. */
export function buildShareMeta(imageUrl: string | undefined): ShareMetaTag[] {
  if (imageUrl === undefined) {
    return [{ name: "twitter:card", content: "summary" }];
  }

  return [
    { property: "og:image", content: imageUrl },
    { property: "og:image:width", content: SHARE_IMAGE_WIDTH },
    { property: "og:image:height", content: SHARE_IMAGE_HEIGHT },
    { property: "og:image:alt", content: PRODUCT_NAME },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:image", content: imageUrl },
  ];
}

/**
 * The instance's public origin: the operator's PUBLIC_BASE_URL on the server,
 * which is what a crawler reads, and the page's own origin in the browser.
 */
export const readPublicOrigin = createIsomorphicFn()
  .server((): string | undefined => getServerEnv()["PUBLIC_BASE_URL"])
  .client((): string | undefined => window.location.origin);
