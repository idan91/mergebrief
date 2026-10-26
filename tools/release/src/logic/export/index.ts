import type { Result } from "types/utils";

import type { GitPort } from "../../types";
import { formatReleaseVersion, parseReleaseVersion } from "../version";
import { classifyTrackedPaths } from "./classify";
import { checkTreeLinks } from "./link-check";
import { materializeTree, resolveExportSource } from "./materialize";
import type { ExportError, ExportOptions, ExportReport } from "./types";

/**
 * The export up to the tree: one commit main holds, classified by the
 * manifest, its shipped paths written to `out`, then the link check over
 * that tree. It fetches the remote main and writes nothing else in the
 * repository; the shipped files land in `out` only.
 */
export function runExport(
  git: GitPort,
  options: ExportOptions,
): Result<ExportReport, ExportError> {
  const version = parseReleaseVersion(options.version);
  if (version === undefined) {
    const reason = `--version ${options.version} is not X.Y.Z or X.Y.Z-rc.N`;
    return { ok: false, error: { reason } };
  }

  const commit = resolveExportSource(git, options.source);
  if (!commit.ok) {
    return commit;
  }
  const classified = classifyTrackedPaths(git.listTrackedPaths(commit.value));
  if (!classified.ok) {
    const reason = classified.error.unclassified
      .map((entry) => `unclassified top-level path: ${entry}`)
      .join("\n");
    return { ok: false, error: { reason } };
  }

  const { shipped, excluded } = classified.value;
  const written = materializeTree(git, {
    commit: commit.value,
    shipped,
    out: options.out,
  });
  if (!written.ok) {
    return written;
  }

  return {
    ok: true,
    value: {
      version: formatReleaseVersion(version),
      commit: commit.value,
      out: options.out,
      fileCount: shipped.length,
      excluded,
      linkHits: checkTreeLinks(options.out, shipped),
    },
  };
}
