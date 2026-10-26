import type { Result } from "types/utils";

import { formatReleaseVersion, parseReleaseVersion } from "../version";
import { classifyTrackedPaths } from "./classify";
import { runGates } from "./gates";
import { materializeTree, resolveExportSource } from "./materialize";
import { executePublish, planPublish } from "./publish";
import {
  formatExportHeader,
  formatGateVerdict,
  formatPublishedAction,
  formatPublishPlan,
} from "./report";
import type {
  ExportDeps,
  ExportError,
  ExportHeader,
  ExportOptions,
  ExportOutcome,
  PublishInput,
  PublishPlan,
} from "./types";

function publishTree(
  deps: ExportDeps,
  options: ExportOptions,
  input: PublishInput,
): Result<PublishPlan, ExportError> {
  const planned = planPublish(deps.git, input);
  if (!planned.ok) {
    return planned;
  }
  deps.print(formatPublishPlan(planned.value, options.dryRun));

  const token = options.token;
  const publishes = !options.dryRun && token !== undefined;
  if (publishes) {
    const target = { url: options.publicRepository.url, token };
    executePublish(deps.git, planned.value, target, (action) => {
      deps.print(formatPublishedAction(planned.value, action));
    });
  }
  return planned;
}

/**
 * One commit main holds, classified by the manifest, its shipped paths
 * written to `out`, every gate over that tree in order, then the release
 * commit built and, outside a dry run, pushed. The header, each verdict and
 * the plan print as they land; apart from fetching the remote main and the
 * pushes, nothing outside `out` is kept.
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
  deps.print(formatExportHeader(header, options.dryRun));
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
  if (!gates.passed) {
    return { ok: true, value: { header, gates } };
  }

  const published = publishTree(deps, options, {
    version: header.version,
    source: commit.value,
    shipped,
    out: options.out,
    dryRun: options.dryRun,
    publicRepository: options.publicRepository,
    token: options.token,
  });
  if (!published.ok) {
    return published;
  }
  return { ok: true, value: { header, gates, publish: published.value } };
}
