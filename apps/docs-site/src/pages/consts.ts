/** The pages that build into the site, relative to `docs/`. A page joins only by a deliberate add here. */
export const SITE_PAGE_GLOBS = [
  "self-host/*.md",
  "repo-config/*.md",
  "architecture.md",
  "api-changelog.md",
  "releases/*.md",
] as const;

/** The Self-hosting group's reading order: set up, configure, secure, then operate. A page left off follows them, by path. */
export const SELF_HOST_PAGE_ORDER: readonly string[] = [
  "self-host/README.md",
  "self-host/compose.md",
  "self-host/github-app.md",
  "self-host/cloud-deployment.md",
  "self-host/configuration.md",
  "self-host/generators.md",
  "self-host/repo-config.md",
  "self-host/trackers.md",
  "self-host/attachments.md",
  "self-host/cli.md",
  "self-host/security-model.md",
  "self-host/observability.md",
  "self-host/upgrade.md",
  "self-host/backup-restore.md",
  "self-host/secrets.md",
  "self-host/data-and-scaling.md",
  "self-host/troubleshooting.md",
  "self-host/uninstall.md",
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

export const HOME_PAGE_SOURCE = "self-host/README.md";
export const HOME_PAGE_TARGET = "index.md";
export const RELEASES_FOLDER = "releases/";
export const MARKDOWN_GLOB = "**/*.md";
