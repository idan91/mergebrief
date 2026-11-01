import type { ExclusionRuleSite, ExportPaths } from "./types";

/**
 * The one list of what the public snapshot holds. A new top-level entry
 * fails the export until it is named here; an exclude prefix applies
 * whether or not the source commit tracks anything under it.
 */
export const EXPORT_PATHS = {
  include: [
    ".dependency-cruiser.alias.cjs",
    ".dependency-cruiser.cjs",
    ".dockerignore",
    ".env.example",
    ".github/",
    ".gitignore",
    ".nvmrc",
    ".oxlintrc.json",
    ".prettierignore",
    ".prettierrc.json",
    "AGENTS.md",
    "CLAUDE.md",
    "CONTEXT.md",
    "CONTRIBUTING.md",
    "DESIGN.md",
    "Dockerfile",
    "LICENSE",
    "PRODUCT.md",
    "README.md",
    "SECURITY.md",
    "apps/",
    "docker/",
    "docker-compose.external-db.yml",
    "docker-compose.tracing.yml",
    "docker-compose.yml",
    "docker-entrypoint.sh",
    "docs/",
    "knip.jsonc",
    "mergebrief.config.example.yaml",
    "oxlint-suppressions.json",
    "package.json",
    "packages/",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "skills/",
    "tools/",
    "vitest.shared.ts",
  ],
  exclude: [
    ".claude/",
    ".serena/",
    "docs/internal/",
    "docs/plans/",
    "tools/categorizer/.mergebrief/",
    "tools/categorizer/eval/private-cases/",
    "tools/categorizer/eval/private-pair-cases/",
    "tools/categorizer/test/pipeline-goldens-private.test.ts",
    "tools/categorizer/test/__snapshots__/pipeline-goldens-private.test.ts.snap",
    "tools/categorizer/test/eval-summary-media-cases.test.ts",
    ".github/workflows/eval-presence.yml",
    ".github/workflows/publish.yml",
  ],
} as const satisfies ExportPaths;

/** Lines that state the exclusion rule itself; the link check lets them name a prefix. */
export const EXCLUSION_RULE_SITES = [
  {
    path: "AGENTS.md",
    fragment: "which the public release snapshot excludes",
  },
] as const satisfies readonly ExclusionRuleSite[];
