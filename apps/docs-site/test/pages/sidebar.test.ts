import { describe, expect, it } from "vitest";

import {
  buildSidebar,
  compareReleaseVersions,
  readPageTrail,
} from "../../src/pages/sidebar";
import {
  type SidebarLabels,
  type SitePage,
  SelfHostPhases,
} from "../../src/pages/types";

const PAGES: SitePage[] = [
  { source: "README.md", link: "/", title: "MergeBrief documentation" },
  {
    source: "api-changelog.md",
    link: "/api-changelog",
    title: "API changelog",
  },
  {
    source: "architecture.md",
    link: "/architecture",
    title: "How MergeBrief works",
  },
  { source: "glossary.md", link: "/glossary", title: "Glossary" },
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
    link: "/self-host/README",
    title: "Self-hosting MergeBrief",
  },
  {
    source: "self-host/secrets.md",
    link: "/self-host/secrets",
    title: "Rotate secrets",
  },
  {
    source: "self-host/attachments.md",
    link: "/self-host/attachments",
    title: "Attachments",
  },
  { source: "use/cli.md", link: "/use/cli", title: "The mergebrief CLI" },
];

const LABELS: SidebarLabels = {
  selfHosting: "label:selfHosting",
  repoConfig: "label:repoConfig",
  use: "label:use",
  reference: "label:reference",
  releases: "label:releases",
  selfHostPhases: {
    [SelfHostPhases.SET_UP]: "label:setUp",
    [SelfHostPhases.CONFIGURE]: "label:configure",
    [SelfHostPhases.SECURE]: "label:secure",
    [SelfHostPhases.OPERATE]: "label:operate",
  },
};

function stubPages(sources: readonly string[]): SitePage[] {
  return sources.map((source) => ({ source, link: "/page", title: source }));
}

describe("buildSidebar", () => {
  it("groups pages by folder, use first, the home page in no group", () => {
    expect(buildSidebar(PAGES, LABELS)).toEqual([
      {
        text: "label:use",
        items: [{ text: "The mergebrief CLI", link: "/use/cli" }],
      },
      {
        text: "label:selfHosting",
        items: [
          {
            text: "label:setUp",
            collapsed: false,
            items: [
              { text: "Self-hosting MergeBrief", link: "/self-host/README" },
            ],
          },
          {
            text: "label:configure",
            collapsed: true,
            items: [{ text: "Attachments", link: "/self-host/attachments" }],
          },
          {
            text: "label:secure",
            collapsed: true,
            items: [{ text: "Rotate secrets", link: "/self-host/secrets" }],
          },
        ],
      },
      {
        text: "label:repoConfig",
        items: [{ text: "Risk policy", link: "/repo-config/policy" }],
      },
      {
        text: "label:reference",
        items: [
          { text: "Glossary", link: "/glossary" },
          { text: "How MergeBrief works", link: "/architecture" },
          { text: "API changelog", link: "/api-changelog" },
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

  it("orders use pages for reading, unlisted pages last", () => {
    const [group] = buildSidebar(
      stubPages(["use/zeta.md", "use/cli.md", "use/reviewing.md"]),
      LABELS,
    );

    expect(group?.items.map((item) => item.text)).toEqual([
      "use/reviewing.md",
      "use/cli.md",
      "use/zeta.md",
    ]);
  });

  it("orders repo config pages for reading, unlisted pages last", () => {
    const repoConfigPages = stubPages([
      "repo-config/faq.md",
      "repo-config/policy.md",
      "repo-config/instructions-template.md",
      "repo-config/README.md",
      "repo-config/trigger-conditions.md",
      "repo-config/settings.md",
      "repo-config/instructions.md",
    ]);

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

  it("splits self-hosting into phases in reading order, unlisted pages last", () => {
    const selfHostPages = stubPages([
      "self-host/uninstall.md",
      "self-host/zeta.md",
      "self-host/upgrade.md",
      "self-host/compose.md",
      "self-host/glossary.md",
      "self-host/README.md",
      "self-host/backup-restore.md",
    ]);

    const [group] = buildSidebar(selfHostPages, LABELS);

    expect(group?.items).toEqual([
      {
        text: "label:setUp",
        collapsed: false,
        items: [
          { text: "self-host/README.md", link: "/page" },
          { text: "self-host/compose.md", link: "/page" },
        ],
      },
      {
        text: "label:operate",
        collapsed: true,
        items: [
          { text: "self-host/upgrade.md", link: "/page" },
          { text: "self-host/backup-restore.md", link: "/page" },
          { text: "self-host/uninstall.md", link: "/page" },
        ],
      },
      { text: "self-host/glossary.md", link: "/page" },
      { text: "self-host/zeta.md", link: "/page" },
    ]);
  });

  it("orders reference pages for reading, unlisted pages last", () => {
    const [group] = buildSidebar(
      stubPages(["api-changelog.md", "vision.md", "architecture.md"]),
      LABELS,
    );

    expect(group?.items.map((item) => item.text)).toEqual([
      "architecture.md",
      "api-changelog.md",
      "vision.md",
    ]);
  });

  it("drops a group with no pages", () => {
    expect(
      buildSidebar(PAGES.slice(0, 4), LABELS).map((group) => group.text),
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

describe("readPageTrail", () => {
  it.each([
    ["self-host/secrets.md", ["label:selfHosting", "label:secure"]],
    ["self-host/unlisted.md", ["label:selfHosting"]],
    ["repo-config/trigger-conditions.md", ["label:repoConfig"]],
    ["releases/0.3.0.md", ["label:releases"]],
    ["glossary.md", ["label:reference"]],
    ["README.md", []],
  ])("places %s under %j", (source, trail) => {
    expect(readPageTrail(source, LABELS)).toEqual(trail);
  });
});
