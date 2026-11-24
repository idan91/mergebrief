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
  "packages/generators/src/adapters/claudeCode.ts",
  "packages/generators/src/adapters/codex.ts",
  "packages/generators/src/adapters/cursor.ts",
];

/**
 * Server source files that mention the environment without reading a key:
 * composition roots hand `process.env` on whole, and a type or a pass-through
 * names it. Every other reader must be a listed parser, so a new env read
 * cannot land outside this check.
 */
export const ENV_READER_SKIPS: ReadonlyMap<string, string> = new Map([
  [
    "apps/api/src/app.ts",
    "names process.env only in a comment saying it never reads it",
  ],
  ["apps/api/src/instrument.ts", "hands process.env to the tracing parser"],
  [
    "apps/api/src/main.ts",
    "composition root; its one key read, MERGEBRIEF_RUNTIME, is exempt",
  ],
  ["apps/api/src/migrate.ts", "composition root; hands process.env on whole"],
  [
    "apps/api/src/routes/auth/session/types.ts",
    "names process.env only in a doc comment",
  ],
  [
    "apps/web/src/server/env.ts",
    "the web server's root; hands process.env on whole",
  ],
  [
    "apps/worker/src/index.ts",
    "names process.env only in a comment saying it never reads it",
  ],
  ["apps/worker/src/instrument.ts", "hands process.env to the tracing parser"],
  [
    "apps/worker/src/main.ts",
    "composition root; its one key read, MERGEBRIEF_RUNTIME, is exempt",
  ],
  [
    "packages/brief-core/src/context/trackers/tokens.ts",
    "reads a tracker token by the variable name the config names",
  ],
  [
    "packages/generators/src/config/moved-variables.ts",
    "reads keys moved to mergebrief.config.yaml only to warn",
  ],
  [
    "packages/generators/src/harness/run.ts",
    "forwards the passVars list it is given",
  ],
  ["packages/github/src/index.ts", "names process.env only in a doc comment"],
  [
    "packages/persistence/src/auth/crypto.ts",
    "reads a key by the ref name the config names",
  ],
  [
    "packages/persistence/src/index.ts",
    "names process.env only in a doc comment",
  ],
]);

/**
 * The server processes' source: the api, the worker, the web server, and the
 * packages they load. The CLI runs on a user's machine and the web client
 * reads only Vite's build-time `import.meta.env`, so neither is in scope.
 * Source pathspecs only, so no env file is ever matched.
 */
export const ENV_READER_PATHSPECS: readonly string[] = [
  ":(glob)apps/api/src/**/*.ts",
  ":(glob)apps/worker/src/**/*.ts",
  ":(glob)apps/web/src/server/**/*.ts",
  ":(glob)packages/*/src/**/*.ts",
  ":(glob)packages/*/src/**/*.tsx",
  ":(exclude,glob)**/testing/**",
  ":(exclude,glob)**/*.test.ts",
  ":(exclude,glob)**/*.test.tsx",
];

/** POSIX ERE without `\b`, which macOS git's regex engine silently ignores. */
export const ENV_READER_PATTERN = String.raw`process\.env|(^|[^A-Za-z0-9_])env(\[|\.[A-Z])|passVars`;

/** A harness's `passVars: ["KEY", ...]` list; each quoted key in group 1 is a read. */
export const PASS_VARS_LIST = /passVars:\s*\[([^\]]*)\]/g;
export const QUOTED_KEY = /"([A-Z][A-Z0-9_]*)"/g;

export const ENV_KEY_EXEMPTIONS: ReadonlyMap<string, string> = new Map([
  ["NODE_ENV", "the image sets it; a source checkout leaves it unset"],
  ["SERVER_VERSION", "the image build stamps it"],
  ["MERGEBRIEF_RUNTIME", "the image's runtime marker, never set by hand"],
  ["MERGEBRIEF_OUT_DIR", "a source-checkout override, never set in production"],
  ["GENERATOR_API_KEY_ENV", "removed; read only to warn"],
  ["XDG_CONFIG_HOME", "the operating system or the user's shell sets it"],
  [
    "CLAUDE_CODE_MAX_OUTPUT_TOKENS",
    "the adapter sets it on the child CLI; the operator never does",
  ],
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
  /\?\s*"([A-Z][A-Z0-9_]*)"\s*:\s*"[A-Z][A-Z0-9_]*"/g,
  /\?\s*"[A-Z][A-Z0-9_]*"\s*:\s*"([A-Z][A-Z0-9_]*)"/g,
];
