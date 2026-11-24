export const ENV_EXAMPLE_PATH = ".env.example";

/**
 * The server processes' config parsers, by explicit path: never a glob, so no
 * env file can ever be opened. `moved-variables.ts` is left out because it
 * reads keys moved to `mergebrief.config.yaml` only to warn about them.
 */
export const ENV_PARSER_PATHS: readonly string[] = [
  "apps/api/src/config.ts",
  "apps/api/src/boot/index.ts",
  "apps/api/src/boot/attachment-limits.ts",
  "apps/api/src/boot/local-briefs-dir.ts",
  "apps/api/src/boot/migrate.ts",
  "apps/api/src/boot/update-check-source.ts",
  "apps/worker/src/config.ts",
  "apps/web/src/server/api/origin.ts",
  "packages/github/src/config.ts",
  "packages/persistence/src/db/config.ts",
  "packages/persistence/src/db/dsn.ts",
  "packages/logging/src/logger.ts",
  "packages/logging/src/tracing/config.ts",
  "packages/generators/src/config/loader.ts",
  "packages/generators/src/config/instancePolicy.ts",
  "packages/generators/src/config/registry.ts",
  "packages/generators/src/config/context-sources.ts",
];

export const ENV_KEY_EXEMPTIONS: ReadonlyMap<string, string> = new Map([
  ["NODE_ENV", "the image sets it; a source checkout leaves it unset"],
  ["SERVER_VERSION", "the image build stamps it"],
  ["MERGEBRIEF_RUNTIME", "the image's runtime marker, never set by hand"],
  ["MERGEBRIEF_OUT_DIR", "a source-checkout override, never set in production"],
  ["GENERATOR_API_KEY_ENV", "removed; read only to warn"],
  ["MERGEBRIEF_URL_BOX_TOKEN", "renamed; read only to warn"],
  ["MERGEBRIEF_URL_BOX_TOKEN_REVIEWERS", "removed; read only to warn"],
]);

export const ENV_KEY_SHAPE = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/;

/** Each form captures the key name in group 1. */
export const ENV_READ_FORMS: readonly RegExp[] = [
  /\[\s*"([A-Z][A-Z0-9_]*)"\s*\]/g,
  /\benv,\s*"([A-Z][A-Z0-9_]*)"/g,
  /^\s*([A-Z][A-Z0-9_]*)\??:\s*(?!["'`])\S/gm,
  /\bconst\s+[A-Z0-9_]*(?:_KEY|_VAR|_ENV|_REF)\s*=\s*"([A-Z][A-Z0-9_]*)"/g,
  /[?:]\s*"([A-Z][A-Z0-9_]*)"/g,
];
