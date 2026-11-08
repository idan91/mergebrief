import { describe, expect, it } from "vitest";

import { buildFontPreloads, buildIconLinks } from "../src/head";

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

describe("buildIconLinks", () => {
  it("links the 16px, svg and touch icons under the site base", () => {
    expect(buildIconLinks("/docs/")).toEqual([
      [
        "link",
        {
          rel: "icon",
          type: "image/png",
          sizes: "16x16",
          href: "/docs/favicon-16.png",
        },
      ],
      [
        "link",
        { rel: "icon", type: "image/svg+xml", href: "/docs/favicon.svg" },
      ],
      ["link", { rel: "apple-touch-icon", href: "/docs/apple-touch-icon.png" }],
    ]);
  });

  it("adds the slash a base written without one is missing", () => {
    const hrefs = buildIconLinks("/docs").map(([, attrs]) => attrs["href"]);

    expect(hrefs).toEqual([
      "/docs/favicon-16.png",
      "/docs/favicon.svg",
      "/docs/apple-touch-icon.png",
    ]);
  });
});
