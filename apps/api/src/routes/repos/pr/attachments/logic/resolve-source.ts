import {
  isAttachmentAssetId,
  readAssetPathId,
  type AttachmentAssetId,
} from "contract";

const PUBLIC_ASSET_HOST = "github.com";
const SIGNED_IMAGE_HOST = "private-user-images.githubusercontent.com";
const SIGNED_ASSET_PATH =
  /^\/\d+\/\d+-([^/.]+)\.(?:png|jpe?g|gif|webp|mp4|mov|webm)$/i;

function hasBareAuthority(url: URL): boolean {
  return url.port === "" && url.username === "" && url.password === "";
}

function readPublicAssetPathId(url: URL): string | undefined {
  if (url.search !== "") {
    return undefined;
  }
  return readAssetPathId(url.pathname);
}

function readHostAssetPathId(url: URL): string | undefined {
  if (url.hostname === PUBLIC_ASSET_HOST) {
    return readPublicAssetPathId(url);
  }
  if (url.hostname === SIGNED_IMAGE_HOST) {
    const [, id] = SIGNED_ASSET_PATH.exec(url.pathname) ?? [];
    return id?.toLowerCase();
  }
  return undefined;
}

/**
 * The asset a rendered source serves, read only off the exact shapes GitHub
 * renders an attachment as: the bare asset URL (or its older per-repository
 * form) for a public repo, the signed path for a private one. A commenter
 * can put any github.com URL in a body, so a path that merely contains an
 * id (a raw file in their own repo, say) names no asset.
 */
export function readRenderedAssetId(
  source: string,
): AttachmentAssetId | undefined {
  let url: URL;
  try {
    url = new URL(source);
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:" || !hasBareAuthority(url)) {
    return undefined;
  }
  const id = readHostAssetPathId(url);
  if (id === undefined || !isAttachmentAssetId(id)) {
    return undefined;
  }
  return id;
}

/** The rendered URL that serves `assetId`, or undefined when the PR has none. */
export function resolveAttachmentSource(
  sources: readonly string[],
  assetId: AttachmentAssetId,
): string | undefined {
  const source = sources.find(
    (candidate) => readRenderedAssetId(candidate) === assetId,
  );
  return source === undefined ? undefined : new URL(source).href;
}
