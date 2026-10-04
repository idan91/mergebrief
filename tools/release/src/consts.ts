export const RELEASES_DIR = "docs/releases";

export const NOTES_EXTENSION = ".md";

export const FRONT_MATTER_FENCE = "---";

/** The heading a breaking release's notes must carry. */
export const UPGRADE_HEADING = "## Upgrade";

export const IMAGE_REPOSITORY = "ghcr.io/idan91/mergebrief";

/** The tag the repo's compose files pin; the stamp swaps it for the release. */
export const DEV_IMAGE_TAG = "dev";

/** The version the repo keeps in the CLI manifest; the stamp replaces it. */
export const DEV_PACKAGE_VERSION = "0.0.0";

export const CLI_PACKAGE_PATH = "apps/cli/package.json";

export const COMPOSE_PATHS = [
  "docker-compose.yml",
  "docker-compose.external-db.yml",
] as const;
