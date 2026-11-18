import type { HeadConfig } from "vitepress";

/** The latin 400 faces body text and code set in, the two the first paint needs. */
const BODY_FONT_FILE =
  /\/ibm-plex-(?:sans|mono)-latin-400-normal\.[\w-]+\.woff2$/;

/** The brand's icon set under the site base: the pixel-exact 16px file, the scalable mark, and the touch tile. */
export function buildIconLinks(base: string): HeadConfig[] {
  const siteRoot = base.endsWith("/") ? base : `${base}/`;

  return [
    [
      "link",
      {
        rel: "icon",
        type: "image/png",
        sizes: "16x16",
        href: `${siteRoot}favicon-16.png`,
      },
    ],
    [
      "link",
      { rel: "icon", type: "image/svg+xml", href: `${siteRoot}favicon.svg` },
    ],
    [
      "link",
      { rel: "apple-touch-icon", href: `${siteRoot}apple-touch-icon.png` },
    ],
  ];
}

export function buildFontPreloads(assets: readonly string[]): HeadConfig[] {
  return assets
    .filter((asset) => BODY_FONT_FILE.test(asset))
    .map((asset) => [
      "link",
      {
        rel: "preload",
        href: asset,
        as: "font",
        type: "font/woff2",
        crossorigin: "",
      },
    ]);
}
