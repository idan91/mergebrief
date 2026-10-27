import type { TFunction } from "i18next";
import type { TranslationKey } from "i18n";
import { ChangeGroupCategories, type ChangeGroupCategory } from "types";
import { LocalBriefKinds, type LocalBriefKind } from "contract";
import {
  type Concern,
  Concerns,
  type RiskSurfaceAttribute,
  RiskSurfaceAttributes,
  type Role,
  Roles,
  type ChangeGroup,
  type LineRange,
  type ReadingOrderStep,
} from "brief-core/types";
import {
  attributeDisplayMeta,
  floorFirst,
  isFloorAttribute,
  type AttributeDisplayMeta,
  type AttributeSource,
  type RepoConfigContext,
} from "./repo-config";
import {
  GroupViewKinds,
  hydrateRemainderGroup,
  type GroupViewKind,
} from "./remainder";
import {
  type Brief,
  type BriefChunk,
  type RiskKey,
  type UnattributedFile,
} from "../types";

interface GroupViewBase {
  kind: GroupViewKind;
  id: string;
  index: number;
  chunks: BriefChunk[];
  added: number;
  deleted: number;
  /** 1-based position in the Brief's Reading order; unset without a valid one. */
  readingOrderStep?: number | undefined;
}

export interface AttributedGroupView extends GroupViewBase {
  kind: typeof GroupViewKinds.ATTRIBUTED;
  group: ChangeGroup;
  coreChunks: BriefChunk[];
  supportingChunks: BriefChunk[];
  /** Derived-line sums over the group's core chunks. */
  coreAdded: number;
  coreDeleted: number;
  /** The Reading-order step's why-line; unset without a valid Reading order. */
  readingOrderWhy?: string | undefined;
}

export interface UnattributedRemainderGroupView extends GroupViewBase {
  kind: typeof GroupViewKinds.UNATTRIBUTED_REMAINDER;
}

export type GroupView = AttributedGroupView | UnattributedRemainderGroupView;

export function isAttributedGroupView(
  group: GroupView,
): group is AttributedGroupView {
  return group.kind === GroupViewKinds.ATTRIBUTED;
}

export interface RiskFlag {
  id: string;
  attr: RiskKey;
  chunkId: string;
  file: string;
  groupId: string;
  /**
   * Catalog key for a built-in attribute's reviewer implication; absent for
   * a repo-defined attribute, whose `criteria` are the repo's own words.
   * Resolved at RENDER (`riskFlagDescription`) so the model stays a pure,
   * locale-free data structure.
   */
  descriptionKey?: TranslationKey;
  /** Repo-authored criteria line (repo-defined attributes only). */
  criteria?: string;
  /** built-in vs repo-policy (structural marker from the snapshot). */
  source: AttributeSource;
  /** Quiet render (repo de-emphasis); already false on floor co-fire chunks. */
  deEmphasized: boolean;
  /** Repo-authored reviewer hint (custom attributes only). */
  implication?: string;
  /** Chunk-specific factual evidence from the chunk's `riskNotes`. */
  note?: string;
}

/** One unattributed file with its counts derived from the ranges. */
export interface UnattributedFileView extends UnattributedFile {
  added: number;
  deleted: number;
}

/** The brief's unattributed remainder with derived per-file + total counts. */
export interface UnattributedView {
  files: UnattributedFileView[];
  added: number;
  deleted: number;
}

export interface BriefViewModel {
  groups: GroupView[];
  flags: RiskFlag[];
  flagsById: Map<string, RiskFlag>;
  flagsByGroup: Map<string, RiskFlag[]>;
  /** Whole-change totals: the brief's exact diff-derived numbers when
      present, else chunk sums plus the unattributed remainder (which can
      double-count inter-chunk overlap lines). */
  totalAdded: number;
  totalDeleted: number;
  /** Derived-line sums over ALL core chunks. */
  totalCoreAdded: number;
  totalCoreDeleted: number;
  /** Present only on briefs that carry the field (absent pre-feature). */
  unattributed?: UnattributedView;
  chunkToGroup: Map<string, string>;
  /** Per-chunk attribute display meta, keyed `chunkId` → `attr`. */
  riskMetaByChunk: Map<string, Map<string, AttributeDisplayMeta>>;
}

const RISK_DESCRIPTION_KEYS: Record<RiskSurfaceAttribute, TranslationKey> = {
  [RiskSurfaceAttributes.NO_TESTS]: "brief.risk.noTests",
  [RiskSurfaceAttributes.NO_TYPES]: "brief.risk.noTypes",
  [RiskSurfaceAttributes.LEGACY_AREA]: "brief.risk.legacyArea",
  [RiskSurfaceAttributes.DENSE_LOGIC]: "brief.risk.denseLogic",
  [RiskSurfaceAttributes.TOUCHES_AUTH]: "brief.risk.touchesAuth",
  [RiskSurfaceAttributes.MUTATES_STATE]: "brief.risk.mutatesState",
  [RiskSurfaceAttributes.REMOVES_VALIDATION]: "brief.risk.removesValidation",
  [RiskSurfaceAttributes.RELAXES_PERMISSIONS]: "brief.risk.relaxesPermissions",
  [RiskSurfaceAttributes.WIDENS_ERROR_HANDLING]:
    "brief.risk.widensErrorHandling",
  [RiskSurfaceAttributes.ADDS_FEATURE_FLAG]: "brief.risk.addsFeatureFlag",
  [RiskSurfaceAttributes.NEW_DEPENDENCY]: "brief.risk.newDependency",
  [RiskSurfaceAttributes.NEW_ABSTRACTION]: "brief.risk.newAbstraction",
  [RiskSurfaceAttributes.COMMENT_CONTRADICTS_CODE]:
    "brief.risk.commentContradictsCode",
  [RiskSurfaceAttributes.ADDS_SECRET]: "brief.risk.addsSecret",
  [RiskSurfaceAttributes.EXTERNAL_IO]: "brief.risk.externalIo",
  [RiskSurfaceAttributes.CROSS_SERVICE]: "brief.risk.crossService",
  [RiskSurfaceAttributes.SCHEMA_ADJACENT]: "brief.risk.schemaAdjacent",
  [RiskSurfaceAttributes.HOT_PATH]: "brief.risk.hotPath",
  [RiskSurfaceAttributes.WIDELY_IMPORTED]: "brief.risk.widelyImported",
  [RiskSurfaceAttributes.RELEASE_IMMINENT]: "brief.risk.releaseImminent",
};

// Category and risk labels also land mid-sentence, so every key here carries
// an `_inline` variant; i18next types `{ context: "inline" }` only on those.
const CATEGORY_LABEL_KEYS = {
  [ChangeGroupCategories.BUGFIX]: "brief.category.bugfix",
  [ChangeGroupCategories.LOGIC_REFACTOR]: "brief.category.logicRefactor",
  [ChangeGroupCategories.MOVE_WITH_EDITS]: "brief.category.moveWithEdits",
  [ChangeGroupCategories.LIB_BUMP]: "brief.category.libBump",
  [ChangeGroupCategories.PURE_MOVE]: "brief.category.pureMove",
  [ChangeGroupCategories.NEW_FEATURE]: "brief.category.newFeature",
  [ChangeGroupCategories.DEPENDENCY_UPDATE]: "brief.category.dependencyUpdate",
  [ChangeGroupCategories.SCHEMA_CHANGE]: "brief.category.schemaChange",
} as const satisfies Record<ChangeGroupCategory, TranslationKey>;

const RISK_LABEL_KEYS = {
  [RiskSurfaceAttributes.NO_TESTS]: "brief.riskLabel.noTests",
  [RiskSurfaceAttributes.NO_TYPES]: "brief.riskLabel.noTypes",
  [RiskSurfaceAttributes.LEGACY_AREA]: "brief.riskLabel.legacyArea",
  [RiskSurfaceAttributes.DENSE_LOGIC]: "brief.riskLabel.denseLogic",
  [RiskSurfaceAttributes.TOUCHES_AUTH]: "brief.riskLabel.touchesAuth",
  [RiskSurfaceAttributes.MUTATES_STATE]: "brief.riskLabel.mutatesState",
  [RiskSurfaceAttributes.REMOVES_VALIDATION]:
    "brief.riskLabel.removesValidation",
  [RiskSurfaceAttributes.RELAXES_PERMISSIONS]:
    "brief.riskLabel.relaxesPermissions",
  [RiskSurfaceAttributes.WIDENS_ERROR_HANDLING]:
    "brief.riskLabel.widensErrorHandling",
  [RiskSurfaceAttributes.ADDS_FEATURE_FLAG]: "brief.riskLabel.addsFeatureFlag",
  [RiskSurfaceAttributes.NEW_DEPENDENCY]: "brief.riskLabel.newDependency",
  [RiskSurfaceAttributes.NEW_ABSTRACTION]: "brief.riskLabel.newAbstraction",
  [RiskSurfaceAttributes.COMMENT_CONTRADICTS_CODE]:
    "brief.riskLabel.commentContradictsCode",
  [RiskSurfaceAttributes.ADDS_SECRET]: "brief.riskLabel.addsSecret",
  [RiskSurfaceAttributes.EXTERNAL_IO]: "brief.riskLabel.externalIo",
  [RiskSurfaceAttributes.CROSS_SERVICE]: "brief.riskLabel.crossService",
  [RiskSurfaceAttributes.SCHEMA_ADJACENT]: "brief.riskLabel.schemaAdjacent",
  [RiskSurfaceAttributes.HOT_PATH]: "brief.riskLabel.hotPath",
  [RiskSurfaceAttributes.WIDELY_IMPORTED]: "brief.riskLabel.widelyImported",
  [RiskSurfaceAttributes.RELEASE_IMMINENT]: "brief.riskLabel.releaseImminent",
} as const satisfies Record<RiskSurfaceAttribute, TranslationKey>;

const CONCERN_LABEL_KEYS: Record<Concern, TranslationKey> = {
  [Concerns.IMPLEMENTATION]: "brief.concern.implementation",
  [Concerns.TEST]: "brief.concern.test",
  [Concerns.DOC]: "brief.concern.doc",
  [Concerns.SPEC]: "brief.concern.spec",
  [Concerns.CONFIG]: "brief.concern.config",
  [Concerns.GENERATED]: "brief.concern.generated",
};

const ROLE_LABEL_KEYS: Record<Role, TranslationKey> = {
  [Roles.CORE]: "brief.chunk.roleCore",
  [Roles.SUPPORTING]: "brief.chunk.roleSupporting",
};

const ARTIFACT_KIND_LABEL_KEYS: Record<LocalBriefKind, TranslationKey> = {
  [LocalBriefKinds.BRIEF]: "shell.artifactBrief",
  [LocalBriefKinds.DELTA]: "shell.artifactDelta",
};

const CONCERN_ORDER: Concern[] = [
  Concerns.IMPLEMENTATION,
  Concerns.TEST,
  Concerns.DOC,
  Concerns.SPEC,
  Concerns.CONFIG,
  Concerns.GENERATED,
];

/**
 * A flag's reviewer-implication line at render time: the built-in catalog
 * copy, else the repo's own criteria (passed through, never translated),
 * else the generic repo-defined line.
 */
export function riskFlagDescription(
  t: TFunction,
  flag: Pick<RiskFlag, "descriptionKey" | "criteria">,
): string {
  if (flag.descriptionKey !== undefined) {
    return t(flag.descriptionKey);
  }
  return flag.criteria ?? t("brief.risk.repoDefined");
}

const BUILT_IN_ATTRIBUTES: ReadonlySet<string> = new Set(
  Object.keys(RISK_DESCRIPTION_KEYS),
);

function isBuiltInAttribute(attr: string): attr is RiskSurfaceAttribute {
  return BUILT_IN_ATTRIBUTES.has(attr);
}

export function buildBriefViewModel(
  brief: Brief,
  repoConfig?: RepoConfigContext | null,
): BriefViewModel {
  const chunkToGroup = new Map<string, string>();

  // Per-chunk display meta first: source, de-emphasis, and the floor co-fire
  // un-quiet rule all resolve from the artifact's snapshot.
  const riskMetaByChunk = new Map<string, Map<string, AttributeDisplayMeta>>();
  for (const chunk of brief.chunks) {
    riskMetaByChunk.set(chunk.id, buildChunkRiskMeta(repoConfig, chunk));
  }

  const sourceOrderGroups = brief.changeGroups.map((group, index) => {
    const id = group.id;
    const groupChunks = brief.chunks.filter(
      (chunk) => chunk.changeGroupId === id,
    );
    groupChunks.forEach((chunk) => chunkToGroup.set(chunk.id, id));
    const coreChunks = sortByConcern(
      groupChunks.filter((chunk) => chunk.role === Roles.CORE),
    );
    const supportingChunks = sortByConcern(
      groupChunks.filter((chunk) => chunk.role === Roles.SUPPORTING),
    );

    return {
      kind: GroupViewKinds.ATTRIBUTED,
      id,
      index,
      group,
      chunks: [...coreChunks, ...supportingChunks],
      coreChunks,
      supportingChunks,
      added: sumLoc(groupChunks, "added"),
      deleted: sumLoc(groupChunks, "deleted"),
      coreAdded: sumLoc(coreChunks, "added"),
      coreDeleted: sumLoc(coreChunks, "deleted"),
    } satisfies AttributedGroupView;
  });

  const attributed = orderGroupsByReadingOrder(
    sourceOrderGroups,
    brief.readingOrder,
  );
  const groups = appendRemainderGroup(attributed, brief, chunkToGroup);
  const remainderChunks = groups
    .filter((group) => !isAttributedGroupView(group))
    .flatMap((group) => group.chunks);
  for (const chunk of remainderChunks) {
    riskMetaByChunk.set(chunk.id, buildChunkRiskMeta(repoConfig, chunk));
  }

  const coreOnly = brief.chunks.filter((chunk) => chunk.role === Roles.CORE);
  const unattributed = buildUnattributedView(brief.unattributed);

  const flags: RiskFlag[] = [];
  const flagsById = new Map<string, RiskFlag>();
  const flagsByGroup = new Map<string, RiskFlag[]>();
  for (const chunk of [...brief.chunks, ...remainderChunks]) {
    const groupId = chunkToGroup.get(chunk.id) ?? "g1";
    for (const [index, attr] of chunk.riskSurface.entries()) {
      const note = chunk.riskNotes?.find((n) => n.attr === attr)?.note;
      const meta =
        riskMetaByChunk.get(chunk.id)?.get(attr) ??
        ({
          source: "built-in",
          deEmphasized: false,
        } satisfies AttributeDisplayMeta);
      const flag: RiskFlag = {
        id: `${chunk.id}-${attr}-${index}`,
        attr,
        chunkId: chunk.id,
        file: chunk.file,
        groupId,
        source: meta.source,
        deEmphasized: meta.deEmphasized,
      };

      if (isBuiltInAttribute(attr)) {
        flag.descriptionKey = RISK_DESCRIPTION_KEYS[attr];
      } else if (meta.criteria !== undefined) {
        flag.criteria = meta.criteria;
      }
      if (meta.implication !== undefined) {
        flag.implication = meta.implication;
      }
      if (note !== undefined) {
        flag.note = note;
      }

      flags.push(flag);
      flagsById.set(flag.id, flag);
      const groupFlags = flagsByGroup.get(groupId);
      if (groupFlags) {
        groupFlags.push(flag);
      } else {
        flagsByGroup.set(groupId, [flag]);
      }
    }
  }

  const viewModel: BriefViewModel = {
    groups,
    flags,
    flagsById,
    flagsByGroup,
    totalAdded:
      brief.diffTotals?.added ??
      sumLoc(brief.chunks, "added") + (unattributed?.added ?? 0),
    totalDeleted:
      brief.diffTotals?.deleted ??
      sumLoc(brief.chunks, "deleted") + (unattributed?.deleted ?? 0),
    totalCoreAdded: sumLoc(coreOnly, "added"),
    totalCoreDeleted: sumLoc(coreOnly, "deleted"),
    chunkToGroup,
    riskMetaByChunk,
  };

  if (unattributed !== undefined) {
    viewModel.unattributed = unattributed;
  }

  return viewModel;
}

export type CategoryLabel = string;

export function getCategoryLabel(
  t: TFunction,
  category: ChangeGroupCategory,
): CategoryLabel {
  return t(CATEGORY_LABEL_KEYS[category]);
}

/** The category label as it reads mid-sentence ("set to new feature"). */
export function getCategoryInlineLabel(
  t: TFunction,
  category: ChangeGroupCategory,
): CategoryLabel {
  return t(CATEGORY_LABEL_KEYS[category], { context: "inline" });
}

function spaceAttributeName(attr: string): string {
  return attr.replaceAll("-", " ");
}

/**
 * A repo-defined attribute is a kebab identifier with no catalog label, so it
 * reads by its own words: `pii-logging` becomes "Pii logging".
 */
export function humanizeAttributeName(attr: string): string {
  const spaced = spaceAttributeName(attr);
  const first = spaced[0];
  if (first === undefined) {
    return spaced;
  }
  return `${first.toUpperCase()}${spaced.slice(1)}`;
}

export function getRiskAttributeLabel(t: TFunction, attr: RiskKey): string {
  if (isBuiltInAttribute(attr)) {
    return t(RISK_LABEL_KEYS[attr]);
  }
  return humanizeAttributeName(attr);
}

/** The attribute label mid-sentence; a repo-defined one keeps its own case. */
export function getRiskAttributeInlineLabel(
  t: TFunction,
  attr: RiskKey,
): string {
  if (isBuiltInAttribute(attr)) {
    return t(RISK_LABEL_KEYS[attr], { context: "inline" });
  }
  return spaceAttributeName(attr);
}

export function getConcernLabel(t: TFunction, concern: Concern): string {
  return t(CONCERN_LABEL_KEYS[concern]);
}

export function getRoleLabel(t: TFunction, role: Role): string {
  return t(ROLE_LABEL_KEYS[role]);
}

export function getArtifactKindLabel(
  t: TFunction,
  kind: LocalBriefKind,
): string {
  return t(ARTIFACT_KIND_LABEL_KEYS[kind]);
}

/** How many risk chips a chunk header shows before collapsing into "+N". */
const MAX_HEADER_RISK_CHIPS = 2;

export interface RiskChipView {
  /** Attributes rendered as individual chips (at most MAX_HEADER_RISK_CHIPS). */
  shown: RiskKey[];
  /** Attributes folded into the "+N" overflow chip (empty when all fit). */
  overflow: RiskKey[];
}

/**
 * @description Bounds the chunk header's risk lane: up to two attribute chips,
 * the rest fold into a "+N" chip (full list in its tooltip). The rail stays
 * the canonical risk surface; the header only routes attention.
 */
export function riskChipView(risks: RiskKey[]): RiskChipView {
  if (risks.length <= MAX_HEADER_RISK_CHIPS) {
    return { shown: risks, overflow: [] };
  }
  return {
    shown: risks.slice(0, MAX_HEADER_RISK_CHIPS),
    overflow: risks.slice(MAX_HEADER_RISK_CHIPS),
  };
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
 * Recheck the reading-order permutation because fixtures can bypass validation.ts.
 * Invalid or absent orders preserve source order.
 */
function orderGroupsByReadingOrder(
  groups: AttributedGroupView[],
  readingOrder: ReadingOrderStep[] | undefined,
): AttributedGroupView[] {
  if (!readingOrder || readingOrder.length === 0) {
    return groups;
  }
  const byId = new Map(groups.map((group) => [group.id, group]));
  const stepGroupIds = readingOrder.map((step) => step.groupId);
  const isPermutation =
    stepGroupIds.length === groups.length &&
    new Set(stepGroupIds).size === stepGroupIds.length &&
    stepGroupIds.every((id) => byId.has(id));
  if (!isPermutation) {
    return groups;
  }
  const ordered = readingOrder
    .map((step, index): AttributedGroupView | undefined => {
      const group = byId.get(step.groupId);
      if (!group) {
        return undefined;
      }
      return {
        ...group,
        index,
        readingOrderStep: index + 1,
        readingOrderWhy: step.why,
      };
    })
    .filter((group): group is AttributedGroupView => group !== undefined);
  // isPermutation guarantees every step resolves; this is a defensive
  // fallback in case that invariant is ever violated.
  return ordered.length === groups.length ? ordered : groups;
}

/** Source, de-emphasis and the floor co-fire un-quiet rule, per attribute a chunk carries. */
function buildChunkRiskMeta(
  repoConfig: RepoConfigContext | null | undefined,
  chunk: BriefChunk,
): Map<string, AttributeDisplayMeta> {
  const chunkFiresFloor = chunk.riskSurface.some(isFloorAttribute);
  const metaByAttr = new Map<string, AttributeDisplayMeta>();
  for (const attr of chunk.riskSurface) {
    const meta = attributeDisplayMeta(
      repoConfig,
      attr,
      chunk.file,
      chunkFiresFloor,
    );
    metaByAttr.set(attr, meta);
  }
  return metaByAttr;
}

function appendRemainderGroup(
  attributed: AttributedGroupView[],
  brief: Brief,
  chunkToGroup: Map<string, string>,
): GroupView[] {
  const usedIds = new Set(brief.chunks.map((chunk) => chunk.id));
  const hydration = hydrateRemainderGroup(brief.unattributed, usedIds);
  if (hydration === undefined) {
    return attributed;
  }

  const remainder: UnattributedRemainderGroupView = {
    kind: GroupViewKinds.UNATTRIBUTED_REMAINDER,
    id: GroupViewKinds.UNATTRIBUTED_REMAINDER,
    index: attributed.length,
    chunks: hydration.chunks,
    added: hydration.added,
    deleted: hydration.deleted,
  };
  if (attributed[0]?.readingOrderStep !== undefined) {
    remainder.readingOrderStep = attributed.length + 1;
  }

  for (const chunk of hydration.chunks) {
    chunkToGroup.set(chunk.id, remainder.id);
  }

  return [...attributed, remainder];
}

function sumLoc(chunks: BriefChunk[], key: keyof BriefChunk["loc"]): number {
  return chunks.reduce((total, chunk) => total + chunk.loc[key], 0);
}

/** Ranges arrive engine-canonical (disjoint, ascending), a plain sum counts. */
function sumRanges(ranges: LineRange[]): number {
  return ranges.reduce(
    (total, range) => total + (range.end - range.start + 1),
    0,
  );
}

function buildUnattributedView(
  files: UnattributedFile[] | undefined,
): UnattributedView | undefined {
  if (files === undefined) {
    return undefined;
  }
  const fileViews = files.map((file) => ({
    ...file,
    added: sumRanges(file.addedRanges),
    deleted: sumRanges(file.removedRanges),
  }));
  return {
    files: fileViews,
    added: fileViews.reduce((total, file) => total + file.added, 0),
    deleted: fileViews.reduce((total, file) => total + file.deleted, 0),
  };
}

/** One jump-rail entry: an attribute + its carrying groups. */
export interface AttributeRailEntry {
  attr: RiskKey;
  source: AttributeSource;
  floor: boolean;
  /** Groups with at least one LOUD firing, in story (display) order. */
  groupIds: string[];
}

export interface AttributeRail {
  entries: AttributeRailEntry[];
  /** A floor attribute fired somewhere, the rail defaults open. */
  floorFired: boolean;
}

interface LoudFiring {
  groupId: string;
  attr: RiskKey;
  source: AttributeSource;
}

/** One chunk's LOUD firings in risk-surface order; DE-EMPHASIZED ones drop. */
function listChunkFirings(
  model: BriefViewModel,
  groupId: string,
  chunk: BriefChunk,
): LoudFiring[] {
  const firings: LoudFiring[] = [];
  for (const attr of chunk.riskSurface) {
    const meta = model.riskMetaByChunk.get(chunk.id)?.get(attr);
    if (meta?.deEmphasized) {
      continue;
    }
    firings.push({ groupId, attr, source: meta?.source ?? "built-in" });
  }
  return firings;
}

/** Every LOUD firing in story (display) order. */
function listLoudFirings(model: BriefViewModel): LoudFiring[] {
  const firings: LoudFiring[] = [];
  for (const group of model.groups) {
    for (const chunk of group.chunks) {
      firings.push(...listChunkFirings(model, group.id, chunk));
    }
  }
  return firings;
}

/**
 * Build the attribute-keyed jump-rail: fired attributes with
 * their carrying groups in story order, floor pinned first, then first
 * appearance; DE-EMPHASIZED firings are excluded entirely (a group carries
 * an attribute only via a loud firing). Attribute-keyed, never group-ranked.
 */
export function buildAttributeRail(model: BriefViewModel): AttributeRail {
  const groupsByAttr = new Map<RiskKey, string[]>();
  const sourceByAttr = new Map<RiskKey, AttributeSource>();
  for (const firing of listLoudFirings(model)) {
    const groupIds = groupsByAttr.get(firing.attr) ?? [];
    if (!groupIds.includes(firing.groupId)) {
      groupIds.push(firing.groupId);
    }
    groupsByAttr.set(firing.attr, groupIds);
    if (!sourceByAttr.has(firing.attr)) {
      sourceByAttr.set(firing.attr, firing.source);
    }
  }
  const ordered = floorFirst([...groupsByAttr.keys()]);
  const entries = ordered.map((attr) => ({
    attr,
    source: sourceByAttr.get(attr) ?? "built-in",
    floor: isFloorAttribute(attr),
    groupIds: groupsByAttr.get(attr) ?? [],
  }));
  return {
    entries,
    floorFired: entries.some((entry) => entry.floor),
  };
}
