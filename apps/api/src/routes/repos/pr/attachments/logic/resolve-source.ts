import { ATTACHMENT_ASSET_PATH_PREFIX, type AttachmentAssetId } from "contract";

const PUBLIC_ASSET_HOST = "github.com";
const SIGNED_IMAGE_HOST = "private-user-images.githubusercontent.com";
const SIGNED_IMAGE_EXTENSIONS = "png|jpe?g|gif|webp";

function hasBareAuthority(url: URL): boolean {
  return url.port === "" && url.username === "" && url.password === "";
}

/**
 * The exact shapes GitHub renders an attachment as: the bare asset URL for a
 * public repo, the signed image path for a private one. A commenter can put
 * any github.com URL in a body, so a path that merely contains the id (a raw
 * file in their own repo, say) must not stand in for the asset.
 */
function isAttachmentUrl(url: URL, assetId: AttachmentAssetId): boolean {
  if (url.protocol !== "https:" || !hasBareAuthority(url)) {
    return false;
  }
  if (url.hostname === PUBLIC_ASSET_HOST) {
    return (
      url.pathname === `${ATTACHMENT_ASSET_PATH_PREFIX}${assetId}` &&
      url.search === ""
    );
  }
  if (url.hostname === SIGNED_IMAGE_HOST) {
    const signedPath = new RegExp(
      `^/\\d+/\\d+-${assetId}\\.(${SIGNED_IMAGE_EXTENSIONS})$`,
      "i",
    );
    return signedPath.test(url.pathname);
  }
  return false;
}

/** The rendered URL that serves `assetId`, or undefined when the PR has none. */
export function resolveAttachmentSource(
  sources: readonly string[],
  assetId: AttachmentAssetId,
): string | undefined {
  for (const source of sources) {
    let url: URL;
    try {
      url = new URL(source);
    } catch {
      continue;
    }
    if (isAttachmentUrl(url, assetId)) {
      return url.href;
    }
  }
  return undefined;
}
