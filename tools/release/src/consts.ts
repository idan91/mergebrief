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

/** The compose files that pin the image. The external-database overlay names none. */
export const COMPOSE_PATHS = ["docker-compose.yml"] as const;

export const REPOSITORY_URL = "https://github.com/idan91/mergebrief";

export const NPM_PACKAGE = "mergebrief";

/** Where an rc lands on npm; `latest` is never moved by a candidate. */
export const RC_DIST_TAG = "next";

export const UPGRADE_DOC_PATH = "docs/self-host/upgrade.md";

export const BACKUP_DOC_PATH = "docs/self-host/backup-restore.md";

export const UPGRADE_CHAIN_PLACEHOLDER = "{{tag}}";

// The chain in docs/self-host/upgrade.md, "Upgrade on the bundled database",
// with the tag as a placeholder. A test holds the two in step.
export const UPGRADE_CHAIN = `DUMP=mergebrief-$(date -u +%Y%m%dT%H%M%SZ).dump
docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" --format=custom "$POSTGRES_DB"' > "$DUMP" \\
  && docker compose exec -T postgres pg_restore --list < "$DUMP" > /dev/null \\
  && curl -fsSLo docker-compose.yml ${REPOSITORY_URL}/releases/download/${UPGRADE_CHAIN_PLACEHOLDER}/docker-compose.yml \\
  && docker compose pull api web worker \\
  && docker compose stop api web worker \\
  && docker compose up -d --wait`;
