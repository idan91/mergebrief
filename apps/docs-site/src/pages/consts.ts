import { type SelfHostSection, SelfHostPhases } from "./types";

/** The pages that build into the site, relative to `docs/`. A page joins only by a deliberate add here. */
export const SITE_PAGE_GLOBS = [
  "README.md",
  "use/*.md",
  "self-host/*.md",
  "repo-config/*.md",
  "architecture.md",
  "glossary.md",
  "api-changelog.md",
  "releases/*.md",
] as const;

/** The Use MergeBrief group's reading order. A page left off follows them, by path. */
export const USE_PAGE_ORDER: readonly string[] = [
  "use/reviewing.md",
  "use/risk-flags.md",
  "use/cli.md",
];

/** The Self-hosting group's sub-groups and their reading order. A page in no section follows them, by path. */
export const SELF_HOST_SECTIONS: readonly SelfHostSection[] = [
  {
    phase: SelfHostPhases.SET_UP,
    collapsed: false,
    pages: [
      "self-host/README.md",
      "self-host/compose.md",
      "self-host/github-app.md",
      "self-host/server-deployment.md",
    ],
  },
  {
    phase: SelfHostPhases.CONFIGURE,
    collapsed: true,
    pages: [
      "self-host/configuration.md",
      "self-host/generators.md",
      "self-host/spend-cap.md",
      "self-host/repo-config.md",
      "self-host/trackers.md",
      "self-host/attachments.md",
    ],
  },
  {
    phase: SelfHostPhases.SECURE,
    collapsed: true,
    pages: ["self-host/security-model.md", "self-host/secrets.md"],
  },
  {
    phase: SelfHostPhases.OPERATE,
    collapsed: true,
    pages: [
      "self-host/observability.md",
      "self-host/upgrade.md",
      "self-host/backup-restore.md",
      "self-host/data-and-scaling.md",
      "self-host/troubleshooting.md",
      "self-host/uninstall.md",
    ],
  },
];

/** The Repo config group's reading order; a page left off follows them, by path. */
export const REPO_CONFIG_PAGE_ORDER: readonly string[] = [
  "repo-config/README.md",
  "repo-config/settings.md",
  "repo-config/trigger-conditions.md",
  "repo-config/policy.md",
  "repo-config/instructions.md",
  "repo-config/instructions-template.md",
];

/** The Reference group's reading order; a page left off follows them, by path. */
export const REFERENCE_PAGE_ORDER: readonly string[] = [
  "glossary.md",
  "architecture.md",
  "api-changelog.md",
];

/** Builds as the site root and sits in no sidebar group: the site title links to it. */
export const HOME_PAGE_SOURCE = "README.md";
export const HOME_PAGE_TARGET = "index.md";
export const RELEASES_FOLDER = "releases/";
export const MARKDOWN_GLOB = "**/*.md";
