import path from "node:path";
import { createMarkdownRenderer } from "vitepress";
import { describe, expect, it } from "vitest";

import { createLinkRule, readGitHubRef, resolveLink } from "../../src/links";
import { LinkProblemKinds, type LinkContext } from "../../src/links/types";
import { makeTree } from "../helpers";

const REPO = makeTree({
  "CONTEXT.md": "# Context\n",
  "mergebrief.config.example.yaml": "generators: []\n",
  "docs/self-host/README.md": "# Self-hosting MergeBrief\n",
  "docs/self-host/compose.md": "# Compose\n\n## Verifying / troubleshooting\n",
  "docs/vocabulary/risk-surface.md":
    "# Risk surface\n\n## Parked candidates\n\n## Über uns\n",
});
const SRC_DIR = path.join(REPO, "docs");
const HOME = path.join(SRC_DIR, "self-host/README.md");
const COMPOSE = path.join(SRC_DIR, "self-host/compose.md");
const BLOB = "https://github.com/idan91/mergebrief/blob";

const CONTEXT: LinkContext = {
  repoRoot: REPO,
  srcDir: SRC_DIR,
  sitePages: new Set(["self-host/README.md", "self-host/compose.md"]),
  ref: "v0.1.0",
};

describe("resolveLink", () => {
  it.each([
    ["./compose.md", "/self-host/compose.md"],
    [
      "compose.md#verifying--troubleshooting",
      "/self-host/compose.md#verifying--troubleshooting",
    ],
    ["./README.md", "/index.md"],
  ])("points %s at its site page", (href, expected) => {
    expect(resolveLink(href, HOME, CONTEXT)).toEqual({
      ok: true,
      value: expected,
    });
  });

  it.each([
    [
      "../vocabulary/risk-surface.md#parked-candidates",
      `${BLOB}/v0.1.0/docs/vocabulary/risk-surface.md#parked-candidates`,
    ],
    [
      "../vocabulary/risk-surface.md#%C3%BCber-uns",
      `${BLOB}/v0.1.0/docs/vocabulary/risk-surface.md#%C3%BCber-uns`,
    ],
    ["../../CONTEXT.md", `${BLOB}/v0.1.0/CONTEXT.md`],
    [
      "../../mergebrief.config.example.yaml",
      `${BLOB}/v0.1.0/mergebrief.config.example.yaml`,
    ],
    [
      "../vocabulary/",
      "https://github.com/idan91/mergebrief/tree/v0.1.0/docs/vocabulary",
    ],
  ])("points off-site %s at GitHub", (href, expected) => {
    expect(resolveLink(href, COMPOSE, CONTEXT)).toEqual({
      ok: true,
      value: expected,
    });
  });

  it("uses main when no version is set", () => {
    const context: LinkContext = { ...CONTEXT, ref: readGitHubRef(undefined) };

    expect(resolveLink("../../CONTEXT.md", COMPOSE, context)).toEqual({
      ok: true,
      value: `${BLOB}/main/CONTEXT.md`,
    });
  });

  it.each([
    "https://example.com/a.md",
    "mailto:security@example.com",
    "#verifying--troubleshooting",
    "/already/absolute",
  ])("leaves %s untouched", (href) => {
    expect(resolveLink(href, COMPOSE, CONTEXT)).toEqual({
      ok: true,
      value: href,
    });
  });

  it.each([
    ["../vocabulary/missing.md", LinkProblemKinds.MISSING_FILE],
    [
      "../vocabulary/risk-surface.md#no-such-heading",
      LinkProblemKinds.MISSING_ANCHOR,
    ],
    ["../../../outside.md", LinkProblemKinds.OUTSIDE_REPO],
    ["../vocabulary/%E0%A4%A.md", LinkProblemKinds.MALFORMED_HREF],
    ["../vocabulary/risk-surface.md#%E0%A4%A", LinkProblemKinds.MALFORMED_HREF],
  ])("refuses %s", (href, kind) => {
    expect(resolveLink(href, COMPOSE, CONTEXT)).toEqual({
      ok: false,
      error: { kind, href },
    });
  });
});

describe("readGitHubRef", () => {
  it("tags a release version and defaults to main", () => {
    expect(readGitHubRef("0.1.0")).toBe("v0.1.0");
    expect(readGitHubRef("v0.1.0")).toBe("v0.1.0");
    expect(readGitHubRef("")).toBe("main");
  });
});

async function renderWithRule(
  markdown: string,
  env: Record<string, unknown>,
): Promise<string> {
  const md = await createMarkdownRenderer(SRC_DIR, {
    config(renderer) {
      renderer.core.ruler.push("docs-site-links", createLinkRule(CONTEXT));
    },
  });
  return md.render(markdown, env);
}

describe("createLinkRule", () => {
  it("resolves from realPath on the page pass, whatever relativePath says", async () => {
    const html = await renderWithRule(
      "[c](./compose.md#verifying--troubleshooting)",
      {
        realPath: HOME,
        path: path.join(SRC_DIR, "index.md"),
        relativePath: "index.md",
      },
    );

    expect(html).toContain(
      'href="/self-host/compose.html#verifying--troubleshooting"',
    );
  });

  it("resolves from path on the search pass, which has no realPath", async () => {
    const html = await renderWithRule("[ctx](../../CONTEXT.md)", {
      path: COMPOSE,
      relativePath: "self-host/compose.md",
    });

    expect(html).toContain(`href="${BLOB}/v0.1.0/CONTEXT.md"`);
  });

  it("fails the render naming the page and every bad link", async () => {
    const render = renderWithRule(
      "[a](../vocabulary/missing.md) [b](../../../outside.md)",
      { path: COMPOSE },
    );

    await expect(render).rejects.toThrow(
      /self-host\/compose\.md.*\.\.\/vocabulary\/missing\.md \(missing-file\).*\.\.\/\.\.\/\.\.\/outside\.md \(outside-repo\)/s,
    );
  });
});
