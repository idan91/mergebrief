export const Categories = {
  Bugfix: "bugfix",
  LogicRefactor: "logic-refactor",
  MoveWithEdits: "move-with-edits",
  LibBump: "lib-bump",
  PureMove: "pure-move",
  NewFeature: "new-feature",
  DependencyUpdate: "dependency-update",
  SchemaChange: "schema-change",
} as const;

export const Concerns = {
  Implementation: "implementation",
  Test: "test",
  Doc: "doc",
  Spec: "spec",
  Config: "config",
  Generated: "generated",
} as const;

export const Roles = {
  Carrier: "carrier",
  Supporting: "supporting",
} as const;

export const RiskSurfaceAttributes = {
  NoTests: "no-tests",
  NoTypes: "no-types",
  LegacyArea: "legacy-area",
  DenseLogic: "dense-logic",
  TouchesAuth: "touches-auth",
  MutatesState: "mutates-state",
  RemovesValidation: "removes-validation",
  RelaxesPermissions: "relaxes-permissions",
  WidensErrorHandling: "widens-error-handling",
  AddsFeatureFlag: "adds-feature-flag",
  ExternalIo: "external-io",
  CrossService: "cross-service",
  SchemaAdjacent: "schema-adjacent",
  HotPath: "hot-path",
  WidelyImported: "widely-imported",
  ReleaseImminent: "release-imminent",
} as const;

export type ValueOf<T> = T[keyof T];

export type Category = ValueOf<typeof Categories>;
export type Concern = ValueOf<typeof Concerns>;
export type Role = ValueOf<typeof Roles>;
export type RiskSurfaceAttribute = ValueOf<typeof RiskSurfaceAttributes>;

export interface PrRef {
  repo: string;
  number: number;
  title: string;
  url: string;
  sha: string;
}

export interface ChunkLoc {
  added: number;
  deleted: number;
}

export type DiffLineKind = "hunk" | "add" | "del" | "ctx" | "note";

export interface DiffLine {
  kind: DiffLineKind;
  content: string;
  oldLine?: number;
  newLine?: number;
}

export interface BriefChunk {
  id: string;
  file: string;
  concern: Concern;
  role: Role;
  loc: ChunkLoc;
  riskSurface: RiskSurfaceAttribute[];
  diff?: DiffLine[];
}

export interface ChangeGroup {
  summary: string;
  dominantCategory: Category;
  secondaryCategories: Category[];
  uncertain: boolean;
  uncertainBetween: Category[];
  carrierChunkIds: string[];
  supportingChunkIds: string[];
}

export interface ConcernRollup {
  concern: Concern;
  added: number;
  deleted: number;
}

export interface Brief {
  pr: PrRef;
  summary: string;
  changeGroups: ChangeGroup[];
  chunks: BriefChunk[];
  concernView: ConcernRollup[];
}
