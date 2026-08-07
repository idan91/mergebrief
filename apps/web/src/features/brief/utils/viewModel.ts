import {
  attributeDisplayMeta,
  floorFirst,
  isFloorAttribute,
  type AttributeDisplayMeta,
  type AttributeSource,
  type RepoConfigContext,
} from "./repoConfig";
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
  type RiskToken,
} from "../types";

/**
 * The group header's deduped union of member-chunk attribute chips (ADR
 * 0032 #11 display): floor first, fully-de-emphasized attributes collapsed
 * behind "+n". Never counts-as-severity, never an aggregate glyph.
 */
export interface GroupHeaderRisk {
  /** Chips rendered individually — floor-first, then first appearance. */
  shown: RiskToken[];
  /** Attributes whose every firing in this group is de-emphasized ("+n"). */
  deEmphasized: RiskToken[];
}

export interface GroupView {
  id: string;
  index: number;
  group: ChangeGroup;
  chunks: BriefChunk[];
  carrierChunks: BriefChunk[];
  supportingChunks: BriefChunk[];
  added: number;
  deleted: number;
  headerRisk: GroupHeaderRisk;
  /** 1-based position in the Brief's Reading order; unset without a valid one. */
  readingOrderStep?: number;
  /** The Reading-order step's why-line; unset without a valid Reading order. */
  readingOrderWhy?: string;
}

export interface RiskFlag {
  id: string;
  attr: RiskToken;
  chunkId: string;
  file: string;
  groupId: string;
  description: string;
  /** built-in vs repo-policy (structural marker from the snapshot, BRIEF-52). */
  source: AttributeSource;
  /** Quiet render (repo de-emphasis); already false on floor co-fire chunks. */
  deEmphasized: boolean;
  /** Repo-authored reviewer hint (custom attributes only). */
  implication?: string;
  /** Chunk-specific factual evidence from the chunk's `riskNotes` (ADR 0026). */
  note?: string;
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
  /** Per-chunk attribute display meta, keyed `chunkId` → `attr` (BRIEF-52). */
  riskMetaByChunk: Map<string, Map<string, AttributeDisplayMeta>>;
}

export interface RiskAttributeGroup {
  attr: RiskToken;
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
  "new-dependency":
    "A new direct dependency entered a manifest; verify it earns its place — stdlib or an existing dep may cover it.",
  "new-abstraction":
    "A new named abstraction was introduced; check whether an existing pattern or utility already covers it.",
  "comment-contradicts-code":
    "A comment and its adjacent code appear to disagree; read both and resolve which side is right.",
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
  Concerns.IMPLEMENTATION,
  Concerns.TEST,
  Concerns.DOC,
  Concerns.SPEC,
  Concerns.CONFIG,
  Concerns.GENERATED,
];

/** Description for a token: the built-in reviewer-implication line, or the repo's criteria. */
export function riskDescription(
  attr: RiskToken,
  meta: AttributeDisplayMeta,
): string {
  if (isBuiltInAttribute(attr)) {
    return RISK_DESCRIPTIONS[attr];
  }
  return meta.criteria ?? "Repo-defined risk attribute (see repo policy).";
}

const BUILT_IN_ATTRIBUTES: ReadonlySet<string> = new Set(
  Object.keys(RISK_DESCRIPTIONS),
);

function isBuiltInAttribute(attr: string): attr is RiskSurfaceAttribute {
  return BUILT_IN_ATTRIBUTES.has(attr);
}

export function buildBriefViewModel(
  brief: Brief,
  repoConfig?: RepoConfigContext | null,
): BriefViewModel {
  const chunkToGroup = new Map<string, string>();

  // Per-chunk display meta first (BRIEF-52): source, de-emphasis, and the
  // floor co-fire un-quiet rule all resolve from the artifact's snapshot.
  const riskMetaByChunk = new Map<string, Map<string, AttributeDisplayMeta>>();
  for (const chunk of brief.chunks) {
    const chunkFiresFloor = chunk.riskSurface.some(isFloorAttribute);
    const metaByAttr = new Map<string, AttributeDisplayMeta>();
    for (const attr of chunk.riskSurface) {
      metaByAttr.set(
        attr,
        attributeDisplayMeta(repoConfig, attr, chunk.file, chunkFiresFloor),
      );
    }
    riskMetaByChunk.set(chunk.id, metaByAttr);
  }

  const sourceOrderGroups = brief.changeGroups.map((group, index) => {
    const id = group.id;
    const groupChunks = brief.chunks.filter(
      (chunk) => chunk.changeGroupId === id,
    );
    groupChunks.forEach((chunk) => chunkToGroup.set(chunk.id, id));
    const carrierChunks = sortByConcern(
      groupChunks.filter((chunk) => chunk.role === Roles.CARRIER),
    );
    const supportingChunks = sortByConcern(
      groupChunks.filter((chunk) => chunk.role === Roles.SUPPORTING),
    );

    return {
      id,
      index,
      group,
      chunks: [...carrierChunks, ...supportingChunks],
      carrierChunks,
      supportingChunks,
      added: sumLoc(groupChunks, "added"),
      deleted: sumLoc(groupChunks, "deleted"),
      headerRisk: buildGroupHeaderRisk(groupChunks, riskMetaByChunk),
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
      const note = chunk.riskNotes?.find((n) => n.attr === attr)?.note;
      const meta =
        riskMetaByChunk.get(chunk.id)?.get(attr) ??
        ({
          source: "built-in",
          deEmphasized: false,
        } satisfies AttributeDisplayMeta);
      const flag = {
        id: `${chunk.id}-${attr}-${index}`,
        attr,
        chunkId: chunk.id,
        file: chunk.file,
        groupId,
        description: riskDescription(attr, meta),
        source: meta.source,
        deEmphasized: meta.deEmphasized,
        ...(meta.implication !== undefined
          ? { implication: meta.implication }
          : {}),
        ...(note !== undefined ? { note } : {}),
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
    riskMetaByChunk,
  };
}

/**
 * Deduped union of a group's member-chunk attributes: floor first, then
 * first appearance; an attribute goes behind "+n" only when EVERY firing of
 * it in this group is de-emphasized (one loud firing un-collapses it).
 */
function buildGroupHeaderRisk(
  groupChunks: readonly BriefChunk[],
  riskMetaByChunk: ReadonlyMap<
    string,
    ReadonlyMap<string, AttributeDisplayMeta>
  >,
): GroupHeaderRisk {
  const seen: RiskToken[] = [];
  const hasLoudFiring = new Set<string>();
  for (const chunk of groupChunks) {
    for (const attr of chunk.riskSurface) {
      if (!seen.includes(attr)) seen.push(attr);
      const meta = riskMetaByChunk.get(chunk.id)?.get(attr);
      if (meta === undefined || !meta.deEmphasized) hasLoudFiring.add(attr);
    }
  }
  const ordered = floorFirst(seen);
  return {
    shown: ordered.filter((attr) => hasLoudFiring.has(attr)),
    deEmphasized: ordered.filter((attr) => !hasLoudFiring.has(attr)),
  };
}

export function categoryLabel(category: Category): string {
  return category.replace("-", " ");
}

/** How many risk chips a chunk header shows before collapsing into "+N". */
const MAX_HEADER_RISK_CHIPS = 2;

export interface RiskChipView {
  /** Attributes rendered as individual chips (at most MAX_HEADER_RISK_CHIPS). */
  shown: RiskToken[];
  /** Attributes folded into the "+N" overflow chip (empty when all fit). */
  overflow: RiskToken[];
}

/**
 * @description Bounds the chunk header's risk lane: up to two attribute chips,
 * the rest fold into a "+N" chip (full list in its tooltip). The rail stays
 * the canonical risk surface; the header only routes attention.
 */
export function riskChipView(risks: RiskToken[]): RiskChipView {
  if (risks.length <= MAX_HEADER_RISK_CHIPS) {
    return { shown: risks, overflow: [] };
  }
  return {
    shown: risks.slice(0, MAX_HEADER_RISK_CHIPS),
    overflow: risks.slice(MAX_HEADER_RISK_CHIPS),
  };
}

export function groupRiskByAttribute(flags: RiskFlag[]): RiskAttributeGroup[] {
  const groups = new Map<RiskToken, RiskFlag[]>();
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

/** One jump-rail entry (ADR 0032 #11): an attribute + its carrying groups. */
export interface AttributeRailEntry {
  attr: RiskToken;
  source: AttributeSource;
  floor: boolean;
  /** Groups with at least one LOUD firing, in story (display) order. */
  groupIds: string[];
  /** Chunks with a LOUD firing, story order — the Concerns-lens targets
      (BRIEF-134: Story cycles groups, Concerns cycles chunks). */
  chunkIds: string[];
}

export interface AttributeRail {
  entries: AttributeRailEntry[];
  /** A floor attribute fired somewhere — the rail defaults open. */
  floorFired: boolean;
}

/**
 * Build the attribute-keyed jump-rail (ADR 0032 #11): fired attributes with
 * their carrying groups in story order — floor pinned first, then first
 * appearance; DE-EMPHASIZED firings are excluded entirely (a group carries
 * an attribute only via a loud firing). Attribute-keyed, never group-ranked.
 */
export function buildAttributeRail(model: BriefViewModel): AttributeRail {
  const groupsByAttr = new Map<RiskToken, string[]>();
  const chunksByAttr = new Map<RiskToken, string[]>();
  const sourceByAttr = new Map<RiskToken, AttributeSource>();
  for (const group of model.groups) {
    for (const chunk of group.chunks) {
      for (const attr of chunk.riskSurface) {
        const meta = model.riskMetaByChunk.get(chunk.id)?.get(attr);
        if (meta?.deEmphasized) continue;
        const groupIds = groupsByAttr.get(attr) ?? [];
        if (!groupIds.includes(group.id)) groupIds.push(group.id);
        groupsByAttr.set(attr, groupIds);
        const chunkIds = chunksByAttr.get(attr) ?? [];
        if (!chunkIds.includes(chunk.id)) chunkIds.push(chunk.id);
        chunksByAttr.set(attr, chunkIds);
        if (!sourceByAttr.has(attr)) {
          sourceByAttr.set(attr, meta?.source ?? "built-in");
        }
      }
    }
  }
  const ordered = floorFirst([...groupsByAttr.keys()]);
  const entries = ordered.map((attr) => ({
    attr,
    source: sourceByAttr.get(attr) ?? "built-in",
    floor: isFloorAttribute(attr),
    groupIds: groupsByAttr.get(attr) ?? [],
    chunkIds: chunksByAttr.get(attr) ?? [],
  }));
  return {
    entries,
    floorFired: entries.some((entry) => entry.floor),
  };
}
