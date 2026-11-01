import { describe, expect, it } from "vitest";

import { buildFaviconLink, buildFontPreloads } from "../src/head";

describe("buildFontPreloads", () => {
  it("preloads only the latin 400 sans and mono files", () => {
    const assets = [
      "/assets/ibm-plex-sans-latin-400-normal.B3x_9k.woff2",
      "/assets/ibm-plex-mono-latin-400-normal.Cq1-2a.woff2",
      "/assets/ibm-plex-sans-latin-600-normal.D9a.woff2",
      "/assets/ibm-plex-sans-cyrillic-400-normal.E1b.woff2",
      "/assets/ibm-plex-sans-latin-400-normal.F2c.woff",
      "/assets/style.G3d.css",
    ];

    expect(buildFontPreloads(assets).map(([, attrs]) => attrs["href"])).toEqual(
      [
        "/assets/ibm-plex-sans-latin-400-normal.B3x_9k.woff2",
        "/assets/ibm-plex-mono-latin-400-normal.Cq1-2a.woff2",
      ],
    );
  });

  it("marks each preload as a cross-origin font", () => {
    const [link] = buildFontPreloads([
      "/docs/assets/ibm-plex-sans-latin-400-normal.B3x.woff2",
    ]);

    expect(link).toEqual([
      "link",
      {
        rel: "preload",
        href: "/docs/assets/ibm-plex-sans-latin-400-normal.B3x.woff2",
        as: "font",
        type: "font/woff2",
        crossorigin: "",
      },
    ]);
  });
});

describe("buildFaviconLink", () => {
  it("links the svg favicon under the site base", () => {
    expect(buildFaviconLink("/docs/")).toEqual([
      "link",
      { rel: "icon", type: "image/svg+xml", href: "/docs/favicon.svg" },
    ]);
  });

  it("adds the slash a base written without one is missing", () => {
    expect(buildFaviconLink("/docs")).toEqual([
      "link",
      { rel: "icon", type: "image/svg+xml", href: "/docs/favicon.svg" },
    ]);
  });
});
