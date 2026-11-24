import { ProvenanceKinds, type ProvenancePattern } from "./types";

// The handle stays legal as the owner segment of the public repo slug and
// its URLs (`idan91/mergebrief`, `ghcr.io/idan91/...`); anywhere else it is
// authored provenance. Bare `#12` and `PR 7` are this product's own domain
// vocabulary, so only references to this repository's pull requests count.
export const PROVENANCE_PATTERNS: readonly ProvenancePattern[] = [
  { kind: ProvenanceKinds.TICKET, pattern: /\bBRIEF-\d+\b/g },
  {
    kind: ProvenanceKinds.HANDLE,
    pattern: /(?<![\w/.-])idan91(?![\w/-]|\.\w)/gi,
  },
  {
    kind: ProvenanceKinds.PULL_REQUEST,
    pattern:
      /\bidan91\/(?:mergebrief|code-review)(?:#|\/(?:pull|issues)\/)\d+/gi,
  },
];

/** Captured data and generated files: they hold citations as recorded. */
export const EXEMPT_PATH_PREFIXES: readonly string[] = [
  "tools/categorizer/eval/cases/",
  "tools/categorizer/eval/pair-cases/",
  "tools/categorizer/test/__snapshots__/",
  "apps/web/src/demo/api/",
  "tools/repo-checks/",
];

export const EXEMPT_PATHS: ReadonlySet<string> = new Set(["pnpm-lock.yaml"]);

/** `.env` and `.env.<anything>` except the committed example. */
export const ENV_FILE_NAME = /^\.env(?:\..+)?$/i;

export const ENV_EXAMPLE_NAME = ".env.example";
