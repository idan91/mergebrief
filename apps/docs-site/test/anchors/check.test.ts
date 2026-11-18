import { describe, expect, it } from "vitest";

import { findDeadAnchors, formatDeadAnchors } from "../../src/anchors/check";
import { AnchorProblemKinds } from "../../src/anchors/types";
import { makeTree } from "../helpers";

function makePage(ids: readonly string[], hrefs: readonly string[]): string {
  const headings = ids.map((id) => `<h2 id="${id}">${id}</h2>`).join("");
  const links = hrefs.map((href) => `<a href="${href}">link</a>`).join("");
  return `<!doctype html><html><body>${headings}${links}</body></html>`;
}

const GOOD = {
  "index.html": makePage(
    ["intro"],
    ["#intro", "/self-host/compose#tls", "/", "https://github.com/x#y"],
  ),
  "self-host/compose.html": makePage(
    ["tls"],
    ["/#intro", "/self-host/compose", "/assets/style.css"],
  ),
  "404.html": makePage([], ["/missing-anywhere#nope"]),
  "assets/style.css": "",
};

describe("findDeadAnchors", () => {
  it("passes a tree whose every internal page and anchor exists", () => {
    expect(findDeadAnchors(makeTree(GOOD), "/")).toEqual([]);
  });

  it("flags a link to a page that was not built", () => {
    const outDir = makeTree({
      ...GOOD,
      "vision.html": makePage([], ["/self-host/gone"]),
    });

    expect(findDeadAnchors(outDir, "/")).toEqual([
      {
        page: "vision.html",
        href: "/self-host/gone",
        kind: AnchorProblemKinds.MISSING_PAGE,
      },
    ]);
  });

  it("flags a same-page fragment with no element", () => {
    const outDir = makeTree({
      ...GOOD,
      "vision.html": makePage(["charter"], ["#charterr"]),
    });

    expect(findDeadAnchors(outDir, "/")).toEqual([
      {
        page: "vision.html",
        href: "#charterr",
        kind: AnchorProblemKinds.MISSING_ANCHOR,
      },
    ]);
  });

  it("flags a cross-page fragment missing on its target", () => {
    const outDir = makeTree({
      ...GOOD,
      "vision.html": makePage([], ["/self-host/compose.html#tsl"]),
    });

    expect(findDeadAnchors(outDir, "/")).toEqual([
      {
        page: "vision.html",
        href: "/self-host/compose.html#tsl",
        kind: AnchorProblemKinds.MISSING_ANCHOR,
      },
    ]);
  });

  it("strips a non-root base and flags a link outside it", () => {
    const outDir = makeTree({
      "index.html": makePage(
        ["intro"],
        ["/docs/#intro", "/docs/vision#charter", "/elsewhere"],
      ),
      "vision.html": makePage(["charter"], ["/docs/"]),
    });

    expect(findDeadAnchors(outDir, "/docs/")).toEqual([
      {
        page: "index.html",
        href: "/elsewhere",
        kind: AnchorProblemKinds.OUTSIDE_BASE,
      },
    ]);
  });

  it("checks a page whose name holds a dot like any other page", () => {
    const outDir = makeTree({
      ...GOOD,
      "releases/0.1.0.html": makePage(["highlights"], []),
      "vision.html": makePage(
        [],
        [
          "/releases/0.1.0#highlights",
          "/releases/0.1.0#no-such-heading",
          "/releases/0.9.9",
        ],
      ),
    });

    expect(findDeadAnchors(outDir, "/")).toEqual([
      {
        page: "vision.html",
        href: "/releases/0.1.0#no-such-heading",
        kind: AnchorProblemKinds.MISSING_ANCHOR,
      },
      {
        page: "vision.html",
        href: "/releases/0.9.9",
        kind: AnchorProblemKinds.MISSING_PAGE,
      },
    ]);
  });

  it("flags a link to an asset that was not built", () => {
    const outDir = makeTree({
      ...GOOD,
      "vision.html": makePage([], ["/assets/gone.css"]),
    });

    expect(findDeadAnchors(outDir, "/")).toEqual([
      {
        page: "vision.html",
        href: "/assets/gone.css",
        kind: AnchorProblemKinds.MISSING_PAGE,
      },
    ]);
  });

  it("flags a malformed escape instead of crashing the build", () => {
    const outDir = makeTree({
      ...GOOD,
      "vision.html": makePage([], ["#%E0%A4%A"]),
    });

    expect(findDeadAnchors(outDir, "/")).toEqual([
      {
        page: "vision.html",
        href: "#%E0%A4%A",
        kind: AnchorProblemKinds.MALFORMED_HREF,
      },
    ]);
  });

  it("decodes an encoded fragment before matching", () => {
    const outDir = makeTree({
      "index.html": makePage(["über"], ["#%C3%BCber"]),
    });

    expect(findDeadAnchors(outDir, "/")).toEqual([]);
  });
});

describe("formatDeadAnchors", () => {
  it("names each page, href and reason", () => {
    const message = formatDeadAnchors([
      {
        page: "vision.html",
        href: "#charterr",
        kind: AnchorProblemKinds.MISSING_ANCHOR,
      },
    ]);

    expect(message).toContain("vision.html: #charterr (missing-anchor)");
  });
});
