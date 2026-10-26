import {
  type ExportReport,
  type LinkHit,
  type LinkHitKind,
  LinkHitKinds,
} from "./types";

const HIT_VERBS: Readonly<Record<LinkHitKind, string>> = {
  [LinkHitKinds.LINK]: "link to",
  [LinkHitKinds.MENTION]: "mention of",
};

function formatLinkHit(hit: LinkHit): string {
  return `  ${hit.path}:${hit.line}: ${HIT_VERBS[hit.kind]} ${hit.target}`;
}

function formatLinkCheck(hits: readonly LinkHit[]): readonly string[] {
  if (hits.length === 0) {
    return ["link check: ok"];
  }
  return [`link check: ${hits.length} hits`, ...hits.map(formatLinkHit)];
}

/** The dry run's header: what was read, what the tree holds, what stayed private. */
export function formatExportReport(report: ExportReport): string {
  const lines = [
    `export ${report.version} (dry run)`,
    `  source   ${report.commit}`,
    `  tree     ${report.out}`,
    `  files    ${report.fileCount}`,
    ...report.excluded.map(
      (excluded) => `  excluded ${excluded.prefix} ${excluded.count}`,
    ),
    ...formatLinkCheck(report.linkHits),
  ];
  return `${lines.join("\n")}\n`;
}
