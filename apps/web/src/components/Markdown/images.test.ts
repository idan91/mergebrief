import type { Element, Root } from "hast";
import { describe, expect, it } from "vitest";

import {
  ATTACHMENT_ASSET_ID as ASSET_ID,
  ATTACHMENT_ASSET_URL as ASSET_URL,
  ATTACHMENT_BRANCH_URL as BRANCH_URL,
  ATTACHMENT_FILE_NAME as FILE_NAME,
  COMMITTED_IMAGE_NORMALISED_URL,
  COMMITTED_IMAGE_URL,
} from "@web/test/attachments";
import { rehypeNormalizeImages, rehypeProxyAttachmentSources } from "./images";

const SCOPE = {
  repoId: "555",
  prNumber: 7,
  installed: true,
  repoSlug: "octo/hello",
};
const COMMITTED_PROXY_PATH = `/api/repos/555/pulls/7/committed-file?source=${encodeURIComponent(COMMITTED_IMAGE_NORMALISED_URL)}`;

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

  it("encodes the repository id into the proxy path", () => {
    const tree = makeTree(makeImage(ASSET_URL));

    rehypeProxyAttachmentSources({ ...SCOPE, repoId: "a/b" })(tree);

    expect(readSource(tree, 0)).toBe(
      `/api/repos/a%2Fb/pulls/7/attachments/${ASSET_ID}`,
    );
  });

  it("routes an older repository asset through the proxy by its id", () => {
    const older = `https://github.com/octo/hello/assets/12345/${ASSET_ID}`;
    const tree = makeTree(makeImage(older));

    rehypeProxyAttachmentSources(SCOPE)(tree);

    expect(readSource(tree, 0)).toBe(
      `/api/repos/555/pulls/7/attachments/${ASSET_ID}`,
    );
  });

  it("routes a committed image of this repository by its normalised address", () => {
    const tree = makeTree(
      makeImage(COMMITTED_IMAGE_URL),
      makeImage(COMMITTED_IMAGE_NORMALISED_URL),
      makeImage(
        "https://raw.githubusercontent.com/Octo/Hello/assets/brief-362/after.png",
      ),
    );

    rehypeProxyAttachmentSources(SCOPE)(tree);

    expect([0, 1, 2].map((index) => readSource(tree, index))).toEqual([
      COMMITTED_PROXY_PATH,
      COMMITTED_PROXY_PATH,
      COMMITTED_PROXY_PATH,
    ]);
  });

  it("leaves a committed image of another repository on github", () => {
    const foreign = COMMITTED_IMAGE_URL.replace("octo/hello", "octo/other");
    const tree = makeTree(makeImage(foreign));

    rehypeProxyAttachmentSources(SCOPE)(tree);

    expect(readSource(tree, 0)).toBe(foreign);
  });

  it("leaves a committed image on github when the repository is unknown", () => {
    const tree = makeTree(makeImage(COMMITTED_IMAGE_URL));

    rehypeProxyAttachmentSources({ ...SCOPE, repoSlug: undefined })(tree);

    expect(readSource(tree, 0)).toBe(COMMITTED_IMAGE_URL);
  });

  it("leaves a committed file in a format the proxy never serves on github", () => {
    const avif = COMMITTED_IMAGE_URL.replace("after.png", "hero.avif");
    const extensionless = COMMITTED_IMAGE_URL.replace("after.png", "hero");
    const tree = makeTree(makeImage(avif), makeImage(extensionless));

    rehypeProxyAttachmentSources(SCOPE)(tree);

    expect(readSource(tree, 0)).toBe(avif);
    expect(readSource(tree, 1)).toBe(extensionless);
  });

  it("leaves an escaping committed path on github", () => {
    const escaping = "https://github.com/octo/hello/raw/main/a%2F..%2Fb.png";
    const tree = makeTree(makeImage(escaping));

    rehypeProxyAttachmentSources(SCOPE)(tree);

    expect(readSource(tree, 0)).toBe(escaping);
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
