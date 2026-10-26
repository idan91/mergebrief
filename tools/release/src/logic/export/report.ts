import {
  type ExportHeader,
  type GateVerdict,
  type LinkHit,
  type LinkHitKind,
  LinkHitKinds,
} from "./types";

const HIT_VERBS: Readonly<Record<LinkHitKind, string>> = {
  [LinkHitKinds.LINK]: "link to",
  [LinkHitKinds.MENTION]: "mention of",
};

const DETAIL_INDENT = "  ";

export function formatLinkHit(hit: LinkHit): string {
  return `${hit.path}:${hit.line}: ${HIT_VERBS[hit.kind]} ${hit.target}`;
}

/** The dry run's header: what was read, what the tree holds, what stayed private. */
export function formatExportHeader(header: ExportHeader): string {
  const lines = [
    `export ${header.version} (dry run)`,
    `  source   ${header.commit}`,
    `  tree     ${header.out}`,
    `  files    ${header.fileCount}`,
    ...header.excluded.map(
      (excluded) => `  excluded ${excluded.prefix} ${excluded.count}`,
    ),
  ];
  return `${lines.join("\n")}\n`;
}

/** One gate's verdict line, then its notices or failure details indented under it. */
export function formatGateVerdict(verdict: GateVerdict): string {
  const { outcome } = verdict;
  const head = outcome.ok
    ? `gate ${verdict.name}: ok, ${outcome.value.summary}`
    : `gate ${verdict.name}: FAILED, ${outcome.error.reason}`;
  const under = outcome.ok ? outcome.value.notices : outcome.error.details;
  const lines = [head, ...under.map((line) => `${DETAIL_INDENT}${line}`)];
  return `${lines.join("\n")}\n`;
}
