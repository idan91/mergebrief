import type { Result } from "types/utils";

import { formatReleaseVersion, parseReleaseVersion } from "../version";
import { classifyTrackedPaths } from "./classify";
import { runGates } from "./gates";
import { materializeTree, resolveExportSource } from "./materialize";
import { formatExportHeader, formatGateVerdict } from "./report";
import type {
  ExportDeps,
  ExportError,
  ExportHeader,
  ExportOptions,
  ExportOutcome,
} from "./types";

/**
 * One commit main holds, classified by the manifest, its shipped paths
 * written to `out`, then every gate over that tree in order. The header and
 * each verdict print as they land; apart from fetching the remote main,
 * nothing outside `out` is kept.
 */
export function runExport(
  deps: ExportDeps,
  options: ExportOptions,
): Result<ExportOutcome, ExportError> {
  const version = parseReleaseVersion(options.version);
  if (version === undefined) {
    const reason = `--version ${options.version} is not X.Y.Z or X.Y.Z-rc.N`;
    return { ok: false, error: { reason } };
  }

  const commit = resolveExportSource(deps.git, options.source);
  if (!commit.ok) {
    return commit;
  }
  const paths = deps.git.listTrackedPaths(commit.value);
  const classified = classifyTrackedPaths(paths);
  if (!classified.ok) {
    const reason = classified.error.unclassified
      .map((entry) => `unclassified top-level path: ${entry}`)
      .join("\n");
    return { ok: false, error: { reason } };
  }

  const { shipped, excluded } = classified.value;
  const written = materializeTree(deps.git, {
    commit: commit.value,
    shipped,
    out: options.out,
  });
  if (!written.ok) {
    return written;
  }

  const header: ExportHeader = {
    version: formatReleaseVersion(version),
    commit: commit.value,
    out: options.out,
    fileCount: shipped.length,
    excluded,
  };
  deps.print(formatExportHeader(header));
  const gates = runGates(
    {
      dir: options.out,
      version: header.version,
      shipped,
      dryRun: options.dryRun,
      publicRepository: options.publicRepository,
    },
    deps,
    (verdict) => {
      deps.print(formatGateVerdict(verdict));
    },
  );
  return { ok: true, value: { header, gates } };
}
