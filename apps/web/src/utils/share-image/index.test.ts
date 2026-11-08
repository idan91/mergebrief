import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { buildShareImageUrl, buildShareMeta } from ".";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const SHARE_IMAGE_FILE = join(TEST_DIR, "../../../public/og-image.png");
const IHDR_WIDTH_OFFSET = 16;
const IHDR_HEIGHT_OFFSET = 20;

describe("buildShareImageUrl", () => {
  it("resolves the share image against the public origin", () => {
    expect(buildShareImageUrl("https://brief.example.com")).toBe(
      "https://brief.example.com/og-image.png",
    );
  });

  it("keeps the image at the root when the origin carries a path", () => {
    expect(buildShareImageUrl("https://example.com/mergebrief/")).toBe(
      "https://example.com/og-image.png",
    );
  });

  it("names no image without a usable origin", () => {
    expect(buildShareImageUrl(undefined)).toBeUndefined();
    expect(buildShareImageUrl("not a url")).toBeUndefined();
  });

  it("names no image for an origin with no host to resolve against", () => {
    expect(buildShareImageUrl("localhost:3000")).toBeUndefined();
  });
});

describe("buildShareMeta", () => {
  it("names the absolute image on both card protocols", () => {
    const url = "https://brief.example.com/og-image.png";
    const tags = buildShareMeta(url);

    expect(tags).toContainEqual({ property: "og:image", content: url });
    expect(tags).toContainEqual({ name: "twitter:image", content: url });
    expect(tags).toContainEqual({
      name: "twitter:card",
      content: "summary_large_image",
    });
  });

  it("states the size the committed image has", () => {
    const png = readFileSync(SHARE_IMAGE_FILE);
    const tags = buildShareMeta("https://brief.example.com/og-image.png");
    const width = String(png.readUInt32BE(IHDR_WIDTH_OFFSET));
    const height = String(png.readUInt32BE(IHDR_HEIGHT_OFFSET));

    expect(tags).toContainEqual({ property: "og:image:width", content: width });
    expect(tags).toContainEqual({
      property: "og:image:height",
      content: height,
    });
  });

  it("falls back to the plain card with no image", () => {
    expect(buildShareMeta(undefined)).toEqual([
      { name: "twitter:card", content: "summary" },
    ]);
  });
});
