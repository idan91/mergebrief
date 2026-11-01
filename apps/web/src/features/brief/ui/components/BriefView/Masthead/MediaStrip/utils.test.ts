import { extractMedia } from "brief-core/media";
import { describe, expect, it } from "vitest";

import { appI18n } from "@web/i18n/I18nProvider";
import {
  ATTACHMENT_ASSET_ID as ASSET_ID,
  ATTACHMENT_ASSET_URL as ASSET_URL,
  ATTACHMENT_READ_PATH as READ_PATH,
  ATTACHMENT_SCOPE as SCOPE,
  COMMITTED_IMAGE_PROXY_PATH as COMMITTED_PATH,
  COMMITTED_IMAGE_URL,
  MERMAID_SEQUENCE_FENCE as SEQUENCE,
  OUTSIDE_IMAGE_URL as OUTSIDE_URL,
  requireAttachmentAssetId,
} from "@web/test/attachments";
import {
  buildStripEntries,
  describeStripCounts,
  readEntryLabel,
  readOpenLabel,
  readPendingVideoAssetIds,
  readTileSource,
  stepIndex,
} from "./utils";

const LATER_ASSET_ID = "0f6c1f2e-61b3-4d55-9c1a-0b2d7f3e9a10";
const CONFIRMED_ASSET_IDS = new Set([requireAttachmentAssetId(ASSET_ID)]);
const REPO_SLUG = "octo/hello";
const SVG_URL = "https://github.com/octo/hello/raw/main/docs/flow.svg";
const t = appI18n.t;

function readItems(description: string) {
  return extractMedia(description, { repoSlug: REPO_SLUG });
}

describe("buildStripEntries", () => {
  it("serves a pasted image through the proxy with its thumbnail", () => {
    const [entry] = buildStripEntries(
      readItems(`![Login](${ASSET_URL})`),
      SCOPE,
      undefined,
    );

    expect(entry).toMatchObject({
      kind: "image",
      caption: "Login",
      alt: "Login",
      source: `${READ_PATH}/attachments/${ASSET_ID}`,
      thumbnailSource: `${READ_PATH}/attachments/${ASSET_ID}?thumbnail=strip`,
      githubLink: ASSET_URL,
    });
  });

  it("serves a committed image through the committed-file read", () => {
    const [entry] = buildStripEntries(
      readItems(`![After](${COMMITTED_IMAGE_URL})`),
      SCOPE,
      undefined,
    );

    expect(entry).toMatchObject({
      source: COMMITTED_PATH,
      thumbnailSource: `${COMMITTED_PATH}&thumbnail=strip`,
    });
  });

  it("gives a committed svg no thumbnail", () => {
    const [entry] = buildStripEntries(
      readItems(`![Flow](${SVG_URL})`),
      SCOPE,
      undefined,
    );

    expect(entry).toMatchObject({ kind: "image", githubLink: SVG_URL });
    expect(entry).not.toHaveProperty("thumbnailSource");
  });

  it("loads an outside-host image directly with no GitHub link", () => {
    const [entry] = buildStripEntries(
      readItems(`![Shot](${OUTSIDE_URL})`),
      SCOPE,
      undefined,
    );

    expect(entry).toMatchObject({ kind: "image", source: OUTSIDE_URL });
    expect(entry).not.toHaveProperty("thumbnailSource");
    expect(entry).not.toHaveProperty("githubLink");
  });

  it("loads the address directly outside a pull request page", () => {
    const [entry] = buildStripEntries(
      readItems(`![Login](${ASSET_URL})`),
      undefined,
      undefined,
    );

    expect(entry).toMatchObject({ source: ASSET_URL, githubLink: ASSET_URL });
    expect(entry).not.toHaveProperty("thumbnailSource");
  });

  it("lists a pasted asset line only once it is confirmed a video", () => {
    const items = readItems(`Demo:\n\n${ASSET_URL}`);

    expect(buildStripEntries(items, SCOPE, undefined)).toEqual([]);
    expect(
      buildStripEntries(
        items,
        SCOPE,
        new Set([requireAttachmentAssetId(LATER_ASSET_ID)]),
      ),
    ).toEqual([]);
    expect(buildStripEntries(items, SCOPE, CONFIRMED_ASSET_IDS)).toEqual([
      expect.objectContaining({
        kind: "video",
        source: `${READ_PATH}/attachments/${ASSET_ID}`,
      }),
    ]);
  });

  it("leaves out a video the proxy cannot serve", () => {
    const items = readItems(
      '<video src="https://example.com/demo.mp4"></video>',
    );

    expect(buildStripEntries(items, SCOPE, undefined)).toEqual([]);
  });

  it("keeps a diagram's code and type, in document order", () => {
    const entries = buildStripEntries(
      readItems(`${SEQUENCE}\n\n![Shot](${OUTSIDE_URL})`),
      SCOPE,
      undefined,
    );

    expect(entries.map((entry) => entry.kind)).toEqual(["diagram", "image"]);
    expect(entries[0]).toMatchObject({ diagramType: "sequence" });
  });
});

describe("readPendingVideoAssetIds", () => {
  it("names the asset of each pasted line awaiting confirmation", () => {
    const items = readItems(`![Shot](${OUTSIDE_URL})\n\n${ASSET_URL}`);

    expect(readPendingVideoAssetIds(items)).toEqual([ASSET_ID]);
  });
});

describe("describeStripCounts", () => {
  it("counts every kind present, in image, video, diagram order", () => {
    const entries = buildStripEntries(
      readItems(
        `${SEQUENCE}\n\n![A](${OUTSIDE_URL})\n\n![B](${SVG_URL})\n\n${ASSET_URL}`,
      ),
      SCOPE,
      CONFIRMED_ASSET_IDS,
    );

    expect(describeStripCounts(t, entries, "en")).toBe(
      "2 images, 1 video, 1 diagram from the description",
    );
  });

  it("names only the kinds the description holds", () => {
    const entries = buildStripEntries(
      readItems(`![A](${OUTSIDE_URL})`),
      SCOPE,
      undefined,
    );

    expect(describeStripCounts(t, entries, "en")).toBe(
      "1 image from the description",
    );
  });
});

describe("readEntryLabel", () => {
  it("names a diagram with no caption by its type", () => {
    const [entry] = buildStripEntries(readItems(SEQUENCE), SCOPE, undefined);

    expect(entry && readEntryLabel(t, entry)).toBe("Sequence diagram");
  });

  it("names a pasted image with no caption by its kind, never its id", () => {
    const [entry] = buildStripEntries(
      readItems(`![](${ASSET_URL})`),
      SCOPE,
      undefined,
    );

    expect(entry && readEntryLabel(t, entry)).toBe("Image");
  });

  it("prefers the caption the extractor found", () => {
    const [entry] = buildStripEntries(
      readItems(`![Login screen](${OUTSIDE_URL})`),
      SCOPE,
      undefined,
    );

    expect(entry && readEntryLabel(t, entry)).toBe("Login screen");
  });
});

describe("readOpenLabel", () => {
  it("names a caption-less image by its kind alone", () => {
    const [entry] = buildStripEntries(
      readItems(`![](${ASSET_URL})`),
      SCOPE,
      undefined,
    );

    expect(entry && readOpenLabel(t, entry)).toBe("Open image");
  });

  it("names a captioned entry by its caption", () => {
    const [entry] = buildStripEntries(
      readItems(`![Login screen](${OUTSIDE_URL})`),
      SCOPE,
      undefined,
    );

    expect(entry && readOpenLabel(t, entry)).toBe("Open image: Login screen");
  });

  it("names a caption-less diagram by its type", () => {
    const [entry] = buildStripEntries(readItems(SEQUENCE), SCOPE, undefined);

    expect(entry && readOpenLabel(t, entry)).toBe(
      "Open diagram: Sequence diagram",
    );
  });
});

describe("readTileSource", () => {
  it("reads the thumbnail of a proxied image", () => {
    const [entry] = buildStripEntries(
      readItems(`![Login](${ASSET_URL})`),
      SCOPE,
      undefined,
    );

    expect(entry?.kind === "image" && readTileSource(entry)).toBe(
      `${READ_PATH}/attachments/${ASSET_ID}?thumbnail=strip`,
    );
  });

  it("reads the original when there is no thumbnail", () => {
    const [entry] = buildStripEntries(
      readItems(`![Shot](${OUTSIDE_URL})`),
      SCOPE,
      undefined,
    );

    expect(entry?.kind === "image" && readTileSource(entry)).toBe(OUTSIDE_URL);
  });
});

describe("stepIndex", () => {
  it.each([
    [0, 1, 3, 1],
    [2, 1, 3, 0],
    [0, -1, 3, 2],
    [0, 1, 1, 0],
  ])("moves %i by %i in %i places to %i", (index, offset, count, expected) => {
    expect(stepIndex(index, offset, count)).toBe(expected);
  });
});
