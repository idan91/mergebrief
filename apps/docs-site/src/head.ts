import type { HeadConfig } from "vitepress";

/** The latin 400 faces body text and code set in, the two the first paint needs. */
const BODY_FONT_FILE =
  /\/ibm-plex-(?:sans|mono)-latin-400-normal\.[\w-]+\.woff2$/;

export function buildFaviconLink(base: string): HeadConfig {
  const siteRoot = base.endsWith("/") ? base : `${base}/`;

  return [
    "link",
    { rel: "icon", type: "image/svg+xml", href: `${siteRoot}favicon.svg` },
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
