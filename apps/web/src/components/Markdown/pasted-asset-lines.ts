import { readPastedAssetLineId } from "brief-core/media";
import type { AttachmentAssetId } from "contract";
import type { Element } from "hast";
import { visit } from "unist-util-visit";

import type { AttachmentScope } from "./context";
import type { RehypeTransform } from "./types";

/**
 * The hast property the bare-line step writes on a pasted asset link it has
 * not turned into a player: the asset id, so the link asks the page whether
 * GitHub rendered that asset as a video. Read off the node; never forwarded
 * to the DOM.
 */
export const PASTED_ASSET_PROPERTY = "dataPastedAsset";

export interface PastedAssetLineOptions {
  /** The pull request the text belongs to; absent, no line is read. */
  readonly scope: AttachmentScope | undefined;
  /** The assets GitHub rendered as a video; absent until the page has asked. */
  readonly videoAssetIds: ReadonlySet<AttachmentAssetId> | undefined;
}

function buildAssetVideo(address: string): Element {
  return {
    type: "element",
    tagName: "video",
    properties: { src: address, controls: true },
    children: [],
  };
}

/**
 * Runs after sanitize, on the links it kept. A pasted asset written bare and
 * alone on its paragraph line is a recording only when GitHub rendered it as
 * one, so it becomes a video, to be proxied like any other, only once the
 * page's read confirms it; until then it stays the link as written, marked
 * so it asks.
 */
export function rehypePlayPastedAssetLines(
  options: PastedAssetLineOptions,
): RehypeTransform {
  return (tree) => {
    if (options.scope === undefined) {
      return;
    }
    visit(tree, "element", (node, index, parent) => {
      if (node.tagName !== "a" || parent === undefined || index === undefined) {
        return;
      }
      const assetId = readPastedAssetLineId(parent, index);
      const address = node.properties["href"];
      const isBareAssetLink =
        assetId !== undefined && typeof address === "string";
      if (!isBareAssetLink) {
        return;
      }
      if (options.videoAssetIds?.has(assetId) === true) {
        parent.children[index] = buildAssetVideo(address);
        return;
      }
      node.properties[PASTED_ASSET_PROPERTY] = assetId;
    });
  };
}
