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
    source: "repo-config/authoring.md",
    link: "/repo-config/authoring",
    title: "Authoring",
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
        items: [{ text: "Authoring", link: "/repo-config/authoring" }],
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
