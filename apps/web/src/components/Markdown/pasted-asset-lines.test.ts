import { parseSanitizedMarkdown } from "brief-core/sanitized-markdown";
import type { AttachmentAssetId } from "contract";
import type { Element, Root } from "hast";
import { describe, expect, it } from "vitest";

import {
  ATTACHMENT_ASSET_ID as ASSET_ID,
  ATTACHMENT_ASSET_URL as ASSET_URL,
  requireAttachmentAssetId,
} from "@web/test/attachments";
import {
  PASTED_ASSET_PROPERTY,
  rehypePlayPastedAssetLines,
} from "./pasted-asset-lines";

const SCOPE = { repoId: "555", prNumber: 7, installed: true };
const CONFIRMED: ReadonlySet<AttachmentAssetId> = new Set([
  requireAttachmentAssetId(ASSET_ID),
]);
const NONE_CONFIRMED: ReadonlySet<AttachmentAssetId> = new Set();

function readFirstParagraph(tree: Root): Element {
  const paragraph = tree.children.find(
    (node): node is Element => node.type === "element" && node.tagName === "p",
  );
  if (paragraph === undefined) {
    throw new Error("expected a paragraph");
  }
  return paragraph;
}

function readElements(parent: Element): Element[] {
  return parent.children.filter(
    (node): node is Element => node.type === "element",
  );
}

describe("rehypePlayPastedAssetLines", () => {
  it("turns a confirmed bare asset line into a video of that asset", () => {
    const tree = parseSanitizedMarkdown(`Demo:\n${ASSET_URL}`);

    rehypePlayPastedAssetLines({ scope: SCOPE, videoAssetIds: CONFIRMED })(
      tree,
    );

    expect(readElements(readFirstParagraph(tree))).toEqual([
      {
        type: "element",
        tagName: "video",
        properties: { src: ASSET_URL, controls: true },
        children: [],
      },
    ]);
  });

  it("keeps an unconfirmed line a link, marked with its asset id", () => {
    for (const videoAssetIds of [undefined, NONE_CONFIRMED]) {
      const tree = parseSanitizedMarkdown(ASSET_URL);

      rehypePlayPastedAssetLines({ scope: SCOPE, videoAssetIds })(tree);

      const [link] = readElements(readFirstParagraph(tree));
      expect(link?.tagName).toBe("a");
      expect(link?.properties[PASTED_ASSET_PROPERTY]).toBe(ASSET_ID);
    }
  });

  it("leaves a link that is no bare asset line untouched", () => {
    const tree = parseSanitizedMarkdown(`[the recording](${ASSET_URL})`);

    rehypePlayPastedAssetLines({ scope: SCOPE, videoAssetIds: CONFIRMED })(
      tree,
    );

    const [link] = readElements(readFirstParagraph(tree));
    expect(link?.tagName).toBe("a");
    expect(link?.properties[PASTED_ASSET_PROPERTY]).toBeUndefined();
  });

  it("leaves the tree untouched outside a pull request", () => {
    const tree = parseSanitizedMarkdown(ASSET_URL);

    rehypePlayPastedAssetLines({
      scope: undefined,
      videoAssetIds: CONFIRMED,
    })(tree);

    const [link] = readElements(readFirstParagraph(tree));
    expect(link?.tagName).toBe("a");
    expect(link?.properties[PASTED_ASSET_PROPERTY]).toBeUndefined();
  });
});
