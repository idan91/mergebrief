/** The pages that build into the site, relative to `docs/`. A page joins only by a deliberate add here. */
export const SITE_PAGE_GLOBS = [
  "self-host/*.md",
  "repo-config/*.md",
  "architecture.md",
  "api-changelog.md",
  "vision.md",
  "releases/*.md",
] as const;

export const HOME_PAGE_SOURCE = "self-host/README.md";
export const HOME_PAGE_TARGET = "index.md";
export const RELEASES_FOLDER = "releases/";
export const MARKDOWN_GLOB = "**/*.md";
