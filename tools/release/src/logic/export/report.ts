import { PUBLISH_TOKEN_ENV } from "../../consts";
import {
  type ExportHeader,
  type GateVerdict,
  type LinkHit,
  type LinkHitKind,
  LinkHitKinds,
  type PublicRepository,
  type PublishAction,
  PublishActions,
  type PublishPlan,
} from "./types";

const HIT_VERBS: Readonly<Record<LinkHitKind, string>> = {
  [LinkHitKinds.LINK]: "link to",
  [LinkHitKinds.MENTION]: "mention of",
};

const DETAIL_INDENT = "  ";

/** Why a run that needs the public repository stops when none answers there. */
export function formatMissingRepository(repository: PublicRepository): string {
  const cause =
    repository.authenticatesReads === true
      ? `${PUBLISH_TOKEN_ENV} cannot read it, or it does not exist`
      : "a publish needs it";
  return `public repo ${repository.slug} not found; ${cause}`;
}

export function formatLinkHit(hit: LinkHit): string {
  return `${hit.path}:${hit.line}: ${HIT_VERBS[hit.kind]} ${hit.target}`;
}

function formatMode(dryRun: boolean): string {
  return dryRun ? "dry run" : "publish";
}

/** The run's header: what was read, what the tree holds, what stayed private. */
export function formatExportHeader(
  header: ExportHeader,
  dryRun: boolean,
): string {
  const lines = [
    `export ${header.version} (${formatMode(dryRun)})`,
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

const NO_PARENT = "none, first release";

function describeAction(plan: PublishPlan, action: PublishAction): string {
  const described: Readonly<Record<PublishAction, string>> = {
    [PublishActions.PUSH_COMMIT]: `commit ${plan.commit} to main`,
    [PublishActions.PUSH_TAG]: `tag ${plan.tag}`,
    [PublishActions.PUSH_RECORD]: `record ${plan.record}`,
  };
  return described[action];
}

/** What a publish would do: the commit it built, the tag, the changes and the pushes still owed. */
export function formatPublishPlan(plan: PublishPlan, dryRun: boolean): string {
  const { added, edited, deleted } = plan.changes;
  const actions =
    plan.actions.length === 0
      ? `nothing to push, ${plan.version} is published`
      : plan.actions
          .map((action) => `push ${describeAction(plan, action)}`)
          .join(", ");
  const lines = [
    `publish ${plan.version} (${formatMode(dryRun)})`,
    `  source   ${plan.source}`,
    `  parent   ${plan.parent ?? NO_PARENT}`,
    `  commit   ${plan.commit}`,
    `  tag      ${plan.tag}`,
    `  changes  ${added} added, ${edited} edited, ${deleted} deleted`,
    ...plan.notices.map((notice) => `${DETAIL_INDENT}${notice}`),
    `  actions  ${actions}`,
  ];
  return `${lines.join("\n")}\n`;
}

export function formatPublishedAction(
  plan: PublishPlan,
  action: PublishAction,
): string {
  return `pushed ${describeAction(plan, action)}\n`;
}

export const GATES_SKIPPED =
  "no gate ran: an emit only plans; gate this commit with --dry-run --expect-commit\n";

export function formatEmitted(dir: string): string {
  return `emitted the release bundle and plan to ${dir}\n`;
}
