import { CONCERN_CHECKS } from "./playbooks";
import { Concerns, Roles, type Brief, type BriefChunk, type Category, type ChangeGroup, type Concern, type RiskSurfaceAttribute } from "./types";

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
  "no-tests": "Changed code path has no direct test coverage in the brief; verify behavior manually or ask for coverage.",
  "no-types": "Changed code lacks useful type coverage; verify runtime safety and narrowing at the boundary.",
  "legacy-area": "Chunk touches legacy-marked code; verify the change follows current patterns rather than entrenching the old one.",
  "dense-logic": "Chunk contains branching or state-heavy logic; enumerate edge cases before signing off.",
  "touches-auth": "Authentication, authorization, session, or identity behavior changed; verify access boundaries explicitly.",
  "mutates-state": "Chunk writes or invalidates persistent state; check ordering, idempotency, and rollback behavior.",
  "removes-validation": "A guard or validation boundary changed; verify the newly accepted input space is intentional.",
  "relaxes-permissions": "Permission scope may be broader; enumerate newly admitted actors and confirm intent.",
  "widens-error-handling": "Error handling became broader or quieter; verify correctness bugs cannot be hidden.",
  "adds-feature-flag": "Feature-flag behavior changed; check defaults, rollout plan, and cleanup obligation.",
  "external-io": "Chunk reaches outside the process; verify timeout, retry, idempotency, and outage behavior.",
  "cross-service": "Chunk touches a contract consumed outside this app; check compatibility and migration expectations.",
  "schema-adjacent": "Chunk sits near persistence/schema assumptions; verify consistency with the data model.",
  "hot-path": "Chunk lives on a high-traffic or latency-sensitive path; check allocations, sync I/O, and unbounded work.",
  "widely-imported": "Changed API has broad call-site reach; enumerate consumers and contract impact.",
  "release-imminent": "Change appears close to release; verify revert and mitigation paths are clear.",
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
  const groups = brief.changeGroups.map((group, index) => {
    const id = group.id;
    const groupChunks = brief.chunks.filter((chunk) => chunk.changeGroupId === id);
    groupChunks.forEach((chunk) => chunkToGroup.set(chunk.id, id));
    const carrierChunks = groupChunks.filter((chunk) => chunk.role === Roles.Carrier);
    const supportingChunks = groupChunks.filter((chunk) => chunk.role === Roles.Supporting);
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

  const concernChunks = new Map<Concern, BriefChunk[]>();
  for (const concern of CONCERN_ORDER) {
    concernChunks.set(
      concern,
      brief.chunks.filter((chunk) => chunk.concern === concern),
    );
  }

  const flags = brief.chunks.flatMap((chunk) => {
    const groupId = chunkToGroup.get(chunk.id) ?? "g1";
    return chunk.riskSurface.map((attr, index) => ({
      id: `${chunk.id}-${attr}-${index}`,
      attr,
      chunkId: chunk.id,
      file: chunk.file,
      groupId,
      description: RISK_DESCRIPTIONS[attr],
    }));
  });

  return {
    groups,
    flags,
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
    groups.set(flag.attr, [...(groups.get(flag.attr) ?? []), flag]);
  }
  return [...groups.entries()].map(([attr, groupedFlags]) => ({ attr, flags: groupedFlags }));
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
