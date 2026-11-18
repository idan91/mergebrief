import type { Element, Root } from "hast";
import { describe, expect, it } from "vitest";

import {
  ATTACHMENT_ASSET_ID as ASSET_ID,
  ATTACHMENT_ASSET_URL as ASSET_URL,
  ATTACHMENT_BRANCH_URL as BRANCH_URL,
  ATTACHMENT_FILE_NAME as FILE_NAME,
  ATTACHMENT_SCOPE as SCOPE,
  COMMITTED_IMAGE_NORMALISED_URL,
  COMMITTED_IMAGE_PROXY_PATH,
  COMMITTED_IMAGE_URL,
} from "@web/test/attachments";
import {
  buildProxyPath,
  buildThumbnailPath,
  readImageReferrerPolicy,
  readOutsideImageHost,
  rehypeLinkUnservedVideos,
  rehypeNormalizeMedia,
  rehypeProxyAttachmentSources,
  rehypeRecordOriginalSources,
} from "./media";
import { ORIGINAL_SOURCE_PROPERTY } from "./original-source";

function makeImage(src: string | undefined): Element {
  const properties: Element["properties"] = { alt: "Image" };
  if (src !== undefined) {
    properties["src"] = src;
  }
  return { type: "element", tagName: "img", properties, children: [] };
}

function makeVideo(src: string | undefined): Element {
  const properties: Element["properties"] = { controls: true };
  if (src !== undefined) {
    properties["src"] = src;
  }
  return { type: "element", tagName: "video", properties, children: [] };
}

function makeLink(...children: Element[]): Element {
  const properties = { href: "https://example.com/ci" };
  return { type: "element", tagName: "a", properties, children };
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
      COMMITTED_IMAGE_PROXY_PATH,
      COMMITTED_IMAGE_PROXY_PATH,
      COMMITTED_IMAGE_PROXY_PATH,
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

describe("rehypeNormalizeMedia", () => {
  it("removes an image with no source and keeps the rest", () => {
    const tree = makeTree(makeImage(undefined), makeImage(ASSET_URL));

    rehypeNormalizeMedia()(tree);

    expect(tree.children).toHaveLength(1);
    expect(readSource(tree, 0)).toBe(ASSET_URL);
  });

  it("removes a video with no https source and keeps the rest", () => {
    const tree = makeTree(
      makeVideo(undefined),
      makeVideo("/api/secret.mp4"),
      makeVideo(ASSET_URL),
    );

    rehypeNormalizeMedia()(tree);

    expect(tree.children).toHaveLength(1);
    expect(readSource(tree, 0)).toBe(ASSET_URL);
  });
});

describe("rehypeProxyAttachmentSources for a video", () => {
  it("routes a pasted video and a committed video through the proxy", () => {
    const committedVideo = COMMITTED_IMAGE_URL.replace(".png", ".mp4");
    const tree = makeTree(makeVideo(ASSET_URL), makeVideo(committedVideo));

    rehypeProxyAttachmentSources(SCOPE)(tree);

    expect(readSource(tree, 0)).toBe(
      `/api/repos/555/pulls/7/attachments/${ASSET_ID}`,
    );
    expect(readSource(tree, 1)).toBe(
      COMMITTED_IMAGE_PROXY_PATH.replace(".png", ".mp4"),
    );
  });
});

describe("rehypeRecordOriginalSources", () => {
  it("records the address the author wrote on an image and a video", () => {
    const tree = makeTree(makeImage(ASSET_URL), makeVideo(ASSET_URL));

    rehypeRecordOriginalSources()(tree);

    for (const node of tree.children) {
      expect(node.type === "element" && node.properties).toMatchObject({
        [ORIGINAL_SOURCE_PROPERTY]: ASSET_URL,
      });
    }
  });
});

describe("rehypeLinkUnservedVideos", () => {
  const OUTSIDE = "https://example.com/demo.mp4";

  it("keeps a video the proxy serves", () => {
    const tree = makeTree(makeVideo(ASSET_URL));

    rehypeLinkUnservedVideos(SCOPE)(tree);

    expect(tree.children[0]).toMatchObject({ tagName: "video" });
  });

  it("turns a video on an outside host into a link to its address", () => {
    const tree = makeTree(makeVideo(OUTSIDE));

    rehypeLinkUnservedVideos(SCOPE)(tree);

    expect(tree.children).toEqual([
      {
        type: "element",
        tagName: "a",
        properties: { href: OUTSIDE },
        children: [{ type: "text", value: OUTSIDE }],
      },
    ]);
  });

  it("turns every video into a link outside a pull request", () => {
    const tree = makeTree(makeVideo(ASSET_URL));

    rehypeLinkUnservedVideos(undefined)(tree);

    expect(tree.children[0]).toMatchObject({
      tagName: "a",
      properties: { href: ASSET_URL },
    });
  });

  it("leaves a video inside a link as its address text, nesting no link", () => {
    const tree = makeTree(makeLink(makeVideo(ASSET_URL)));

    rehypeLinkUnservedVideos(SCOPE)(tree);

    expect(tree.children[0]).toMatchObject({
      tagName: "a",
      children: [{ type: "text", value: ASSET_URL }],
    });
  });
});

describe("buildThumbnailPath", () => {
  it("asks the attachment read for its strip thumbnail", () => {
    expect(buildThumbnailPath(SCOPE, ASSET_URL)).toBe(
      `/api/repos/555/pulls/7/attachments/${ASSET_ID}?thumbnail=strip`,
    );
  });

  it("asks the committed-file read for its strip thumbnail", () => {
    expect(buildThumbnailPath(SCOPE, COMMITTED_IMAGE_URL)).toBe(
      `${COMMITTED_IMAGE_PROXY_PATH}&thumbnail=strip`,
    );
  });

  it("asks none for a committed svg, which the read never resizes", () => {
    const svg = "https://github.com/octo/hello/raw/main/docs/flow.svg";

    expect(buildThumbnailPath(SCOPE, svg)).toBeUndefined();
    expect(buildProxyPath(SCOPE, svg)).toBe(
      `/api/repos/555/pulls/7/committed-file?source=${encodeURIComponent(svg)}`,
    );
  });

  it("asks none for an image on an outside host", () => {
    const outside = "https://example.com/shot.png";

    expect(buildThumbnailPath(SCOPE, outside)).toBeUndefined();
    expect(buildProxyPath(SCOPE, outside)).toBeUndefined();
  });
});

describe("readImageReferrerPolicy", () => {
  it("sends no referrer to a host outside this instance", () => {
    expect(readImageReferrerPolicy("https://example.com/shot.png")).toBe(
      "no-referrer",
    );
    expect(readImageReferrerPolicy(ASSET_URL)).toBe("no-referrer");
  });

  it("keeps the default for the proxy's same-origin path", () => {
    const proxied = buildProxyPath(SCOPE, ASSET_URL);

    expect(readImageReferrerPolicy(proxied)).toBeUndefined();
    expect(readImageReferrerPolicy(undefined)).toBeUndefined();
  });
});

describe("readOutsideImageHost", () => {
  it("names the host of an image no GitHub host serves", () => {
    expect(readOutsideImageHost("https://i.imgur.com/shot.png")).toBe(
      "i.imgur.com",
    );
  });

  it.each([
    ASSET_URL,
    "https://raw.githubusercontent.com/octo/hello/main/shot.png",
    "https://user-images.githubusercontent.com/1/shot.png",
    "https://github.githubassets.com/images/icons/emoji/tada.png",
  ])("reads %s as GitHub's own", (address) => {
    expect(readOutsideImageHost(address)).toBeUndefined();
  });

  it.each([
    "https://githubusercontent.com.evil.example/shot.png",
    "https://evilgithub.com/shot.png",
    "https://octo.github.io/shot.png",
    "https://camo.githubusercontent.com/0f3a/68747470733a2f2f6576696c",
    "https://render.githubusercontent.com/view/shot.png",
    "https://evil.githubassets.com/shot.png",
    "https://github.com/octo/hello/releases/download/v1/shot.png",
    "https://github.com/octo/hello/releases/latest/download/shot.png",
    "https://github.com/octo/hello/Releases/download/v1/shot.png",
    "https://github.com//octo/hello//releases/download/v1/shot.png",
    "https://github.com/octo/hello/r%65leases/download/v1/shot.png",
    "https://github.com/octo/hello/releases/download/v1/100%.png",
    "https://github.com/octo/hello/r%65leases/download/v1/100%.png",
  ])("never reads %s as GitHub's own", (address) => {
    expect(readOutsideImageHost(address)).toBe(new URL(address).hostname);
  });

  it("reads the proxy's same-origin path as served here", () => {
    const proxied = buildProxyPath(SCOPE, ASSET_URL);

    expect(readOutsideImageHost(proxied)).toBeUndefined();
    expect(readOutsideImageHost(undefined)).toBeUndefined();
  });
});
