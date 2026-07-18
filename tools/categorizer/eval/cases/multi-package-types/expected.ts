import type { EvalProperty } from "../../properties";
import { chunksFor } from "../../briefQueries";

/**
 * code-review#28 — the shared `types` workspace package: new package +
 * ValueOf/Result/Brand dedupe across consumers. The monorepo
 * multi-package seed: chunks span several packages and manifests change
 * in lockstep.
 */

/** Top-level package dir of a repo path ("packages/api/src/x.ts" → "packages/api"). */
function packageDir(path: string): string {
  const parts = path.split("/");
  return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : path;
}

export const properties: EvalProperty[] = [
  {
    id: "spans-multiple-packages",
    description: "chunks cover at least 3 distinct workspace packages",
    check: (brief) =>
      new Set(brief.chunks.map((chunk) => packageDir(chunk.file))).size >= 3,
  },
  {
    id: "manifests-are-config-concern",
    description: "package.json chunks carry the config concern",
    check: (brief) => {
      const manifests = chunksFor(brief, "package.json");
      return (
        manifests.length > 0 &&
        manifests.every((chunk) => chunk.concern === "config")
      );
    },
  },
  {
    id: "types-package-in-one-group",
    description:
      "the new packages/types source lands in a single group (the foundation), not scattered",
    check: (brief) => {
      const groups = new Set(
        brief.chunks
          .filter((chunk) => chunk.file.startsWith("packages/types/"))
          .map((chunk) => chunk.changeGroupId),
      );
      return groups.size === 1;
    },
  },
  {
    id: "coherent-grouping",
    description: "between 1 and 4 groups — a dedupe is one story, maybe split by foundation vs consumers",
    check: (brief) =>
      brief.changeGroups.length >= 1 && brief.changeGroups.length <= 4,
  },
];
