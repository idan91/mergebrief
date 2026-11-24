import { createMarkdownRenderer } from "vitepress";
import { describe, expect, it } from "vitest";

import { type SidebarLabels, SelfHostPhases } from "../src/pages/types";
import { createSearchRender, prefixPageTrail } from "../src/search";

const LABELS: SidebarLabels = {
  selfHosting: "Self-hosting",
  repoConfig: "Repo config",
  use: "Use MergeBrief",
  reference: "Reference",
  releases: "Releases",
  selfHostPhases: {
    [SelfHostPhases.SET_UP]: "Set up",
    [SelfHostPhases.CONFIGURE]: "Configure",
    [SelfHostPhases.SECURE]: "Secure",
    [SelfHostPhases.OPERATE]: "Operate",
  },
};

async function renderForSearch(
  source: string,
  relativePath: string,
): Promise<string> {
  const md = await createMarkdownRenderer(process.cwd());
  const render = createSearchRender(LABELS);
  return render(
    source,
    { path: relativePath, relativePath, cleanUrls: true },
    md,
  );
}

describe("createSearchRender", () => {
  it("puts the group before a page's title", async () => {
    const html = await renderForSearch(
      "# Trigger conditions\n\nText.\n",
      "repo-config/trigger-conditions.md",
    );

    expect(html).toMatch(/<h1[^>]*>Repo config \/ Trigger conditions /);
  });

  it("names a release note by its group and version", async () => {
    const html = await renderForSearch(
      "## Trigger conditions\n\nText.\n",
      "releases/0.3.0.md",
    );

    expect(html).toMatch(/^<h1 tabindex="-1">Releases \/ 0\.3\.0 <a/);
  });

  it("puts a Self-hosting page under its phase", async () => {
    const html = await renderForSearch(
      "# Rotate secrets\n",
      "self-host/secrets.md",
    );

    expect(html).toContain(">Self-hosting / Secure / Rotate secrets");
  });

  it("leaves the home page as rendered", async () => {
    const html = await renderForSearch("# MergeBrief\n", "README.md");

    expect(html).toMatch(/<h1[^>]*>MergeBrief /);
  });

  it("drops a page whose frontmatter turns search off", async () => {
    const html = await renderForSearch(
      "---\nsearch: false\n---\n\n# Hidden\n",
      "glossary.md",
    );

    expect(html).toBe("");
  });
});

describe("prefixPageTrail", () => {
  it("escapes the trail as text", () => {
    expect(prefixPageTrail("<h1>Page</h1>", ["A & <B>"], undefined)).toBe(
      "<h1>A &amp; &lt;B&gt; / Page</h1>",
    );
  });
});
