import type { Element, Root } from "hast";
import { describe, expect, it } from "vitest";

import {
  ATTACHMENT_ASSET_ID as ASSET_ID,
  ATTACHMENT_ASSET_URL as ASSET_URL,
  ATTACHMENT_BRANCH_URL as BRANCH_URL,
  ATTACHMENT_FILE_NAME as FILE_NAME,
} from "@web/test/attachments";
import { rehypeNormalizeImages, rehypeProxyAttachmentSources } from "./images";

const SCOPE = { repoId: "555", prNumber: 7, installed: true };

function makeImage(src: string | undefined): Element {
  const properties: Element["properties"] = { alt: "Image" };
  if (src !== undefined) {
    properties["src"] = src;
  }
  return { type: "element", tagName: "img", properties, children: [] };
}

function makeTree(...children: Element[]): Root {
  return { type: "root", children };
}

function readSource(tree: Root, index: number): unknown {
  const node = tree.children[index];
  if (node?.type !== "element") {
    throw new Error("expected an element");
  }
  return node.properties["src"];
}

describe("rehypeProxyAttachmentSources", () => {
  it("routes a github attachment source through the api proxy", () => {
    const tree = makeTree(makeImage(ASSET_URL));

    rehypeProxyAttachmentSources(SCOPE)(tree);

    expect(readSource(tree, 0)).toBe(
      `/api/repos/555/pulls/7/attachments/${ASSET_ID}`,
    );
  });

  it("routes a branch-hosted file through the proxy by its file name", () => {
    const tree = makeTree(makeImage(BRANCH_URL));

    rehypeProxyAttachmentSources(SCOPE)(tree);

    expect(readSource(tree, 0)).toBe(
      `/api/repos/555/pulls/7/attachments/${FILE_NAME}`,
    );
  });

  it("routes a branch file of another repository to this repo's proxy", () => {
    const foreign = BRANCH_URL.replace("octo/hello", "other/repo");
    const tree = makeTree(makeImage(foreign));

    rehypeProxyAttachmentSources(SCOPE)(tree);

    expect(readSource(tree, 0)).toBe(
      `/api/repos/555/pulls/7/attachments/${FILE_NAME}`,
    );
  });

  it("leaves any other source untouched", () => {
    const tree = makeTree(makeImage("https://example.com/a.png"));

    rehypeProxyAttachmentSources(SCOPE)(tree);

    expect(readSource(tree, 0)).toBe("https://example.com/a.png");
  });

  it("leaves the tree untouched without a scope", () => {
    const tree = makeTree(makeImage(ASSET_URL));

    rehypeProxyAttachmentSources(undefined)(tree);

    expect(readSource(tree, 0)).toBe(ASSET_URL);
  });
});

describe("rehypeNormalizeImages", () => {
  it("removes an image with no source and keeps the rest", () => {
    const tree = makeTree(makeImage(undefined), makeImage(ASSET_URL));

    rehypeNormalizeImages()(tree);

    expect(tree.children).toHaveLength(1);
    expect(readSource(tree, 0)).toBe(ASSET_URL);
  });
});
