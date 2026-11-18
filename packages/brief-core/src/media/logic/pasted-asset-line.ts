import {
  AttachmentSourceKinds,
  parseAttachmentSource,
  type AttachmentAssetId,
} from "contract/attachments";
import type { Element, Root } from "hast";

import {
  isAloneOnLine,
  readHttpsProperty,
  readNonBlank,
  readText,
} from "./text";

/**
 * The asset id of a pasted asset written bare and alone on its paragraph
 * line, the shape GitHub renders as a player when the asset is a recording.
 * `parent.children[index]` is the link; anything else reads as no id.
 */
export function readPastedAssetLineId(
  parent: Root | Element,
  index: number,
): AttachmentAssetId | undefined {
  const link = parent.children[index];
  const inParagraph = parent.type === "element" && parent.tagName === "p";
  const isLink = link?.type === "element" && link.tagName === "a";
  if (!inParagraph || !isLink) {
    return undefined;
  }
  const address = readHttpsProperty(link, "href");
  const linkText = readNonBlank(readText(link));
  const writtenBare = address !== undefined && linkText === address;
  const isBareLine = writtenBare && isAloneOnLine(parent, index);
  if (!isBareLine) {
    return undefined;
  }

  const source = parseAttachmentSource(address);
  const isAsset =
    source.ok && source.value.kind === AttachmentSourceKinds.ASSET;
  return isAsset ? source.value.assetId : undefined;
}
