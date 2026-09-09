import { RiskSurfaceAttributes, type Brief } from "brief-core/types";
import type { EvalProperty } from "../../properties";
import { chunksFor } from "../../briefQueries";

/**
 * The repo-config injection path, which no other case exercises: the
 * CopyButton diff with a `repoContext` carrying one instruction block and two
 * PATH-SCOPED custom attributes. The measurement target is the injection, not
 * the model's taste, so the properties ask where each repo-defined attribute
 * may appear, with a chunking guard against a vacuous pass.
 *
 * Unbaselined on purpose: a first run characterises it, and it is not a
 * regression comparison until a baseline is recorded on main.
 */

const PROP_SURFACE = "prop-surface";
const STYLE_TOKEN_DRIFT = "style-token-drift";

/** What the per-generation enum admits: the built-ins plus these two names. */
const ADMITTED: ReadonlySet<string> = new Set<string>([
  ...RiskSurfaceAttributes,
  PROP_SURFACE,
  STYLE_TOKEN_DRIFT,
]);

/** `riskSurface` carries repo-defined names as plain strings per generation. */
function firesNamed(brief: Brief, name: string, suffix?: string): boolean {
  const chunks = suffix === undefined ? brief.chunks : chunksFor(brief, suffix);
  return chunks.some((chunk) =>
    chunk.riskSurface.some((attr) => attr === name),
  );
}

/** Chunks whose file is NOT the one the attribute's globs admit. */
function chunksOutside(brief: Brief, suffix: string) {
  return brief.chunks.filter((chunk) => !chunk.file.endsWith(suffix));
}

export const properties: EvalProperty[] = [
  {
    id: "scoped-file-is-chunked",
    description:
      "the .types.ts file is chunked at all, so the scope properties below cannot pass vacuously",
    check: (brief) => chunksFor(brief, "CopyButton.types.ts").length > 0,
  },
  {
    id: "repo-attribute-reaches-the-brief",
    description:
      "the repo-defined prop-surface attribute appears on the file its globs admit, which is the only evidence the injected policy reached generation",
    check: (brief) => firesNamed(brief, PROP_SURFACE, "CopyButton.types.ts"),
  },
  {
    id: "second-repo-attribute-also-reaches",
    description:
      "style-token-drift reaches the scss its globs admit, so both declared attributes are gated on reach and not just the first",
    check: (brief) =>
      firesNamed(brief, STYLE_TOKEN_DRIFT, "CopyButton.module.scss"),
  },
  {
    id: "repo-attribute-stays-inside-its-globs",
    description:
      "prop-surface fires on no chunk outside **/*.types.ts, and style-token-drift on none outside **/*.module.scss: the path scope is the API's promise, not a suggestion",
    check: (brief) =>
      !chunksOutside(brief, ".types.ts").some((chunk) =>
        chunk.riskSurface.some((attr) => attr === PROP_SURFACE),
      ) &&
      !chunksOutside(brief, ".module.scss").some((chunk) =>
        chunk.riskSurface.some((attr) => attr === STYLE_TOKEN_DRIFT),
      ),
  },
  {
    id: "no-invented-attribute-names",
    description:
      "every risk token is a built-in or one of the two declared repo attributes: injecting names extends the per-generation enum, it never opens it",
    check: (brief) =>
      brief.chunks.every((chunk) =>
        chunk.riskSurface.every((attr) => ADMITTED.has(attr)),
      ),
  },
];
