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

export const REPOSITORY = {
  owner: "Idan91",
  name: "code-review",
} as const;

export const REPOSITORY_URL = `https://github.com/${REPOSITORY.owner}/${REPOSITORY.name}`;

export const NPM_PACKAGE = "mergebrief";

/** The secret scanner the export runs over its tree, pinned to the multi-arch index digest. */
export const GITLEAKS_IMAGE =
  "ghcr.io/gitleaks/gitleaks:v8.30.1@sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f";

/** The allowlist both secret scans read: the export's, from the tree it scans, and CI's on the PR diff. */
export const GITLEAKS_CONFIG = ".github/gitleaks.toml";

/** Where tags are read from and pushed to; the publishing repository's remote. */
export const GIT_REMOTE = "origin";

export const DEFAULT_BRANCH = "main";

/** The remote default branch as the cut fetched it; never FETCH_HEAD, which any other fetch rewrites. */
export const DEFAULT_BRANCH_REF = `refs/remotes/${GIT_REMOTE}/${DEFAULT_BRANCH}`;

/** Where an rc lands on npm; `latest` is never moved by a candidate. */
export const RC_DIST_TAG = "next";

export const OPERATIONS_DOC_PATH = "docs/self-host/operations.md";

export const UPGRADE_CHAIN_PLACEHOLDER = "{{tag}}";

// The chain in docs/self-host/operations.md, "The upgrade step", with the
// tag as a placeholder. A test holds the two in step.
export const UPGRADE_CHAIN = `DUMP=mergebrief-$(date -u +%Y%m%dT%H%M%SZ).dump
docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" --format=custom "$POSTGRES_DB"' > "$DUMP" \\
  && docker compose exec -T postgres pg_restore --list < "$DUMP" > /dev/null \\
  && curl -fsSLo docker-compose.yml ${REPOSITORY_URL}/releases/download/${UPGRADE_CHAIN_PLACEHOLDER}/docker-compose.yml \\
  && docker compose pull api web worker \\
  && docker compose stop api web worker \\
  && docker compose up -d --wait`;

/** Author and committer of every public release commit and tag; never a personal address. */
export const RELEASE_IDENTITY = {
  name: "Idan Ram",
  email: "44946814+Idan91@users.noreply.github.com",
} as const;

/** The private annotated tag that records a release: `public/vX.Y.Z` on the source commit. */
export const PUBLIC_RECORD_TAG_PREFIX = "public/v";

/** Trailers these addresses signed are the maintainer's own or an agent's, never a contributor's. */
export const CO_AUTHOR_DROP_EMAILS = [
  RELEASE_IDENTITY.email,
  "noreply@anthropic.com",
  "cursoragent@cursor.com",
] as const;

/** The variable the publish token enters through; read at the composition root, re-exported to git's credential helper only. */
export const PUBLISH_TOKEN_ENV = "MERGEBRIEF_PUBLISH_TOKEN";

/** The one branch the public repository holds release commits on. */
export const PUBLIC_BRANCH_REF = `refs/heads/${DEFAULT_BRANCH}`;
