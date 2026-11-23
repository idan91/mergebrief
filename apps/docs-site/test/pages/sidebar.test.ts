import { describe, expect, it } from "vitest";

import { buildSidebar, compareReleaseVersions } from "../../src/pages/sidebar";
import type { SidebarLabels, SitePage } from "../../src/pages/types";

const PAGES: SitePage[] = [
  {
    source: "api-changelog.md",
    link: "/api-changelog",
    title: "API changelog",
  },
  { source: "architecture.md", link: "/architecture", title: "Architecture" },
  {
    source: "releases/0.1.0-rc.1.md",
    link: "/releases/0.1.0-rc.1",
    title: "0.1.0-rc.1",
  },
  { source: "releases/0.1.0.md", link: "/releases/0.1.0", title: "0.1.0" },
  { source: "releases/0.2.0.md", link: "/releases/0.2.0", title: "0.2.0" },
  {
    source: "repo-config/policy.md",
    link: "/repo-config/policy",
    title: "Risk policy",
  },
  {
    source: "self-host/README.md",
    link: "/",
    title: "Self-hosting MergeBrief",
  },
  {
    source: "self-host/attachments.md",
    link: "/self-host/attachments",
    title: "Attachments",
  },
];

const LABELS: SidebarLabels = {
  selfHosting: "label:selfHosting",
  repoConfig: "label:repoConfig",
  reference: "label:reference",
  releases: "label:releases",
};

describe("buildSidebar", () => {
  it("groups pages by folder, home first and releases newest first", () => {
    expect(buildSidebar(PAGES, LABELS)).toEqual([
      {
        text: "label:selfHosting",
        items: [
          { text: "Self-hosting MergeBrief", link: "/" },
          { text: "Attachments", link: "/self-host/attachments" },
        ],
      },
      {
        text: "label:repoConfig",
        items: [{ text: "Risk policy", link: "/repo-config/policy" }],
      },
      {
        text: "label:reference",
        items: [
          { text: "API changelog", link: "/api-changelog" },
          { text: "Architecture", link: "/architecture" },
        ],
      },
      {
        text: "label:releases",
        items: [
          { text: "0.2.0", link: "/releases/0.2.0" },
          { text: "0.1.0", link: "/releases/0.1.0" },
          { text: "0.1.0-rc.1", link: "/releases/0.1.0-rc.1" },
        ],
      },
    ]);
  });

  it("orders repo config pages for reading, unlisted pages last", () => {
    const repoConfigPages: SitePage[] = [
      "repo-config/faq.md",
      "repo-config/policy.md",
      "repo-config/instructions-template.md",
      "repo-config/README.md",
      "repo-config/trigger-conditions.md",
      "repo-config/settings.md",
      "repo-config/instructions.md",
    ].map((source) => ({ source, link: "/repo-config/page", title: source }));

    const [group] = buildSidebar(repoConfigPages, LABELS);

    expect(group?.items.map((item) => item.text)).toEqual([
      "repo-config/README.md",
      "repo-config/settings.md",
      "repo-config/trigger-conditions.md",
      "repo-config/policy.md",
      "repo-config/instructions.md",
      "repo-config/instructions-template.md",
      "repo-config/faq.md",
    ]);
  });

  it("orders self-hosting pages for reading, unlisted pages last", () => {
    const selfHostPages: SitePage[] = [
      "self-host/uninstall.md",
      "self-host/glossary.md",
      "self-host/upgrade.md",
      "self-host/compose.md",
      "self-host/troubleshooting.md",
      "self-host/README.md",
      "self-host/backup-restore.md",
    ].map((source) => ({ source, link: "/self-host/page", title: source }));

    const [group] = buildSidebar(selfHostPages, LABELS);

    expect(group?.items.map((item) => item.text)).toEqual([
      "self-host/README.md",
      "self-host/compose.md",
      "self-host/upgrade.md",
      "self-host/backup-restore.md",
      "self-host/troubleshooting.md",
      "self-host/uninstall.md",
      "self-host/glossary.md",
    ]);
  });

  it("drops a group with no pages", () => {
    expect(
      buildSidebar(PAGES.slice(0, 2), LABELS).map((group) => group.text),
    ).toEqual(["label:reference"]);
  });
});

describe("compareReleaseVersions", () => {
  it.each([
    ["0.10.0", "0.9.0", 1],
    ["0.1.0", "0.1.0-rc.1", 1],
    ["0.1.0-rc.2", "0.1.0-rc.10", -1],
    ["1.0.0", "1.0.0", 0],
  ])("orders %s against %s as %i", (left, right, order) => {
    expect(Math.sign(compareReleaseVersions(left, right))).toBe(order);
  });
});
