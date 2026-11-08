import {
  BOT_AVATAR_SIZE,
  BRAND_COLOR,
  GROUND_COLOR,
  ON_BRAND_COLOR,
  PIXEL_ICON_SIZE,
  SHARE_IMAGE_WIDTH,
  TOUCH_ICON_SIZE,
  WORDMARK_COLOR,
} from "./consts";
import { buildShareImageSvg, buildTileSvg } from "./compose";
import { buildMarkSvg, buildPixelMarkSvg, findMarkCells } from "./mark";
import { renderSvg } from "./raster";
import type { BrandAsset, BrandMasters } from "./types";
import { buildInlineWordmarkSvg } from "./wordmark";

const WEB_ICONS = "apps/web/src/components/icons";
const WEB_PUBLIC = "apps/web/public";
const DOCS_PUBLIC = "apps/docs-site/public";
const TOOL_OUT = "tools/brand/out";

function encodeText(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/** Every file the brand ships, built from the two masters alone. */
export function buildBrandAssets(masters: BrandMasters): BrandAsset[] {
  const { mark, wordmark } = masters;
  const favicon = encodeText(buildMarkSvg(mark, BRAND_COLOR));
  const pixelSvg = buildPixelMarkSvg(findMarkCells(mark), BRAND_COLOR);
  const pixelIcon = renderSvg(pixelSvg, PIXEL_ICON_SIZE).png;
  const touchSvg = buildTileSvg(
    mark,
    TOUCH_ICON_SIZE,
    BRAND_COLOR,
    ON_BRAND_COLOR,
  );
  const touchIcon = renderSvg(touchSvg, TOUCH_ICON_SIZE).png;
  const avatarSvg = buildTileSvg(
    mark,
    BOT_AVATAR_SIZE,
    BRAND_COLOR,
    ON_BRAND_COLOR,
  );
  const shareSvg = buildShareImageSvg(mark, wordmark, {
    ground: GROUND_COLOR,
    mark: BRAND_COLOR,
    wordmark: WORDMARK_COLOR,
  });

  return [
    {
      target: `${WEB_ICONS}/mergebrief-mark.svg`,
      bytes: encodeText(buildMarkSvg(mark, "currentColor")),
    },
    {
      target: `${WEB_ICONS}/mergebrief-wordmark.svg`,
      bytes: encodeText(buildInlineWordmarkSvg(wordmark)),
    },
    { target: `${WEB_PUBLIC}/favicon.svg`, bytes: favicon },
    { target: `${WEB_PUBLIC}/favicon-16.png`, bytes: pixelIcon },
    { target: `${WEB_PUBLIC}/apple-touch-icon.png`, bytes: touchIcon },
    {
      target: `${WEB_PUBLIC}/og-image.png`,
      bytes: renderSvg(shareSvg, SHARE_IMAGE_WIDTH).png,
    },
    { target: `${DOCS_PUBLIC}/favicon.svg`, bytes: favicon },
    { target: `${DOCS_PUBLIC}/favicon-16.png`, bytes: pixelIcon },
    { target: `${DOCS_PUBLIC}/apple-touch-icon.png`, bytes: touchIcon },
    {
      target: `${TOOL_OUT}/bot-avatar.png`,
      bytes: renderSvg(avatarSvg, BOT_AVATAR_SIZE).png,
    },
  ];
}
