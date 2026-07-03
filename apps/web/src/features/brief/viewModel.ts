import { CONCERN_CHECKS } from "./playbooks";
import {
  Concerns,
  Roles,
  type Brief,
  type BriefChunk,
  type Category,
  type ChangeGroup,
  type Concern,
  type ReadingOrderStep,
  type RiskSurfaceAttribute,
} from "./types";

export interface GroupView {
  id: string;
  index: number;
  group: ChangeGroup;
  chunks: BriefChunk[];
  carrierChunks: BriefChunk[];
  supportingChunks: BriefChunk[];
  added: number;
  deleted: number;
  supportConcerns: Concern[];
  /** 1-based position in the Brief's Reading order; unset without a valid one. */
  readingOrderStep?: number;
  /** The Reading-order step's why-line; unset without a valid Reading order. */
  readingOrderWhy?: string;
}

export interface RiskFlag {
  id: string;
  attr: RiskSurfaceAttribute;
  chunkId: string;
  file: string;
  groupId: string;
  description: string;
}

export interface BriefViewModel {
  groups: GroupView[];
  flags: RiskFlag[];
  flagsById: Map<string, RiskFlag>;
  flagsByGroup: Map<string, RiskFlag[]>;
  totalAdded: number;
  totalDeleted: number;
  concernChunks: Map<Concern, BriefChunk[]>;
  chunkToGroup: Map<string, string>;
}

export interface RiskAttributeGroup {
  attr: RiskSurfaceAttribute;
  flags: RiskFlag[];
}

const RISK_DESCRIPTIONS: Record<RiskSurfaceAttribute, string> = {
  "no-tests":
    "Changed code path has no direct test coverage in the brief; verify behavior manually or ask for coverage.",
  "no-types":
    "Changed code lacks useful type coverage; verify runtime safety and narrowing at the boundary.",
  "legacy-area":
    "Chunk touches legacy-marked code; verify the change follows current patterns rather than entrenching the old one.",
  "dense-logic":
    "Chunk contains branching or state-heavy logic; enumerate edge cases before signing off.",
  "touches-auth":
    "Authentication, authorization, session, or identity behavior changed; verify access boundaries explicitly.",
  "mutates-state":
    "Chunk writes or invalidates persistent state; check ordering, idempotency, and rollback behavior.",
  "removes-validation":
    "A guard or validation boundary changed; verify the newly accepted input space is intentional.",
  "relaxes-permissions":
    "Permission scope may be broader; enumerate newly admitted actors and confirm intent.",
  "widens-error-handling":
    "Error handling became broader or quieter; verify correctness bugs cannot be hidden.",
  "adds-feature-flag":
    "Feature-flag behavior changed; check defaults, rollout plan, and cleanup obligation.",
  "external-io":
    "Chunk reaches outside the process; verify timeout, retry, idempotency, and outage behavior.",
  "cross-service":
    "Chunk touches a contract consumed outside this app; check compatibility and migration expectations.",
  "schema-adjacent":
    "Chunk sits near persistence/schema assumptions; verify consistency with the data model.",
  "hot-path":
    "Chunk lives on a high-traffic or latency-sensitive path; check allocations, sync I/O, and unbounded work.",
  "widely-imported":
    "Changed API has broad call-site reach; enumerate consumers and contract impact.",
  "release-imminent":
    "Change appears close to release; verify revert and mitigation paths are clear.",
};

const CONCERN_ORDER: Concern[] = [
  Concerns.Implementation,
  Concerns.Test,
  Concerns.Doc,
  Concerns.Spec,
  Concerns.Config,
  Concerns.Generated,
];

export function buildBriefViewModel(brief: Brief): BriefViewModel {
  const chunkToGroup = new Map<string, string>();
  const sourceOrderGroups = brief.changeGroups.map((group, index) => {
    const id = group.id;
    const groupChunks = brief.chunks.filter(
      (chunk) => chunk.changeGroupId === id,
    );
    groupChunks.forEach((chunk) => chunkToGroup.set(chunk.id, id));
    const carrierChunks = sortByConcern(
      groupChunks.filter((chunk) => chunk.role === Roles.Carrier),
    );
    const supportingChunks = sortByConcern(
      groupChunks.filter((chunk) => chunk.role === Roles.Supporting),
    );
    const supportConcerns = uniqueConcerns(supportingChunks);

    return {
      id,
      index,
      group,
      chunks: [...carrierChunks, ...supportingChunks],
      carrierChunks,
      supportingChunks,
      added: sumLoc(groupChunks, "added"),
      deleted: sumLoc(groupChunks, "deleted"),
      supportConcerns,
    } satisfies GroupView;
  });

  const groups = orderGroupsByReadingOrder(
    sourceOrderGroups,
    brief.readingOrder,
  );

  const concernChunks = new Map<Concern, BriefChunk[]>();
  for (const concern of CONCERN_ORDER) {
    concernChunks.set(
      concern,
      brief.chunks.filter((chunk) => chunk.concern === concern),
    );
  }

  const flags: RiskFlag[] = [];
  const flagsById = new Map<string, RiskFlag>();
  const flagsByGroup = new Map<string, RiskFlag[]>();
  for (const chunk of brief.chunks) {
    const groupId = chunkToGroup.get(chunk.id) ?? "g1";
    for (const [index, attr] of chunk.riskSurface.entries()) {
      const flag = {
        id: `${chunk.id}-${attr}-${index}`,
        attr,
        chunkId: chunk.id,
        file: chunk.file,
        groupId,
        description: RISK_DESCRIPTIONS[attr],
      } satisfies RiskFlag;
      flags.push(flag);
      flagsById.set(flag.id, flag);
      const groupFlags = flagsByGroup.get(groupId);
      if (groupFlags) groupFlags.push(flag);
      else flagsByGroup.set(groupId, [flag]);
    }
  }

  return {
    groups,
    flags,
    flagsById,
    flagsByGroup,
    totalAdded: sumLoc(brief.chunks, "added"),
    totalDeleted: sumLoc(brief.chunks, "deleted"),
    concernChunks,
    chunkToGroup,
  };
}

export function concernChecksFor(concern: Concern): string[] {
  return CONCERN_CHECKS[concern] ?? [];
}

export function concernLabel(concern: Concern): string {
  return concern.replace("-", " ");
}

export function categoryLabel(category: Category): string {
  return category.replace("-", " ");
}

export function groupRiskByAttribute(flags: RiskFlag[]): RiskAttributeGroup[] {
  const groups = new Map<RiskSurfaceAttribute, RiskFlag[]>();
  for (const flag of flags) {
    const groupedFlags = groups.get(flag.attr);
    if (groupedFlags) groupedFlags.push(flag);
    else groups.set(flag.attr, [flag]);
  }
  return [...groups.entries()].map(([attr, groupedFlags]) => ({
    attr,
    flags: groupedFlags,
  }));
}

function buildConcernRank(): Map<Concern, number> {
  const rank = new Map<Concern, number>();
  for (const [index, concern] of CONCERN_ORDER.entries()) {
    rank.set(concern, index);
  }
  return rank;
}

const CONCERN_RANK = buildConcernRank();

/**
 * @description Stable level-2 sort within a role: implementation, test, doc,
 * spec, config, generated (CONCERN_ORDER). Native sort is stable, so ties keep
 * source order.
 */
function sortByConcern(chunks: BriefChunk[]): BriefChunk[] {
  return chunks.toSorted(
    (a, b) =>
      (CONCERN_RANK.get(a.concern) ?? 0) - (CONCERN_RANK.get(b.concern) ?? 0),
  );
}

/**
 * @description Orders `groups` by the Brief's Reading order (ADR 0025) when
 * one is present and valid, attaching each group's step index + why-line;
 * otherwise preserves today's source order untouched (the degrade path —
 * `readingOrder` absent or invalid renders exactly as before this feature).
 * Re-verifies the permutation defensively: the FE boundary parser
 * (`validation.ts`) already drops an invalid `readingOrder`, but callers can
 * hand a `Brief` built outside that parser (fixtures, tests).
 */
function orderGroupsByReadingOrder(
  groups: GroupView[],
  readingOrder: ReadingOrderStep[] | undefined,
): GroupView[] {
  if (!readingOrder || readingOrder.length === 0) return groups;
  const byId = new Map(groups.map((group) => [group.id, group]));
  const stepGroupIds = readingOrder.map((step) => step.groupId);
  const isPermutation =
    stepGroupIds.length === groups.length &&
    new Set(stepGroupIds).size === stepGroupIds.length &&
    stepGroupIds.every((id) => byId.has(id));
  if (!isPermutation) return groups;
  const ordered = readingOrder
    .map((step, index): GroupView | undefined => {
      const group = byId.get(step.groupId);
      if (!group) return undefined;
      return {
        ...group,
        index,
        readingOrderStep: index + 1,
        readingOrderWhy: step.why,
      };
    })
    .filter((group): group is GroupView => group !== undefined);
  // isPermutation guarantees every step resolves; this is a defensive
  // fallback in case that invariant is ever violated.
  return ordered.length === groups.length ? ordered : groups;
}

function sumLoc(chunks: BriefChunk[], key: keyof BriefChunk["loc"]): number {
  return chunks.reduce((total, chunk) => total + chunk.loc[key], 0);
}

function uniqueConcerns(chunks: BriefChunk[]): Concern[] {
  const seen = new Set<Concern>();
  for (const chunk of chunks) {
    if (concernChecksFor(chunk.concern).length > 0) {
      seen.add(chunk.concern);
    }
  }
  return CONCERN_ORDER.filter((concern) => seen.has(concern));
}
