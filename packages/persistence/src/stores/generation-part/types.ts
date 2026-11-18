import type { PartKey } from "brief-core";
import type { ValueOf } from "types/utils";
import type { PullRequestRowId } from "../../types";
import type { GenerationPartBody } from "./schemas";

/** What a stored part holds: the grouping call's output, or one detail call's chunks. */
export const GenerationPartKinds = {
  GROUPING: "grouping",
  DETAIL: "detail",
} as const;
export type GenerationPartKind = ValueOf<typeof GenerationPartKinds>;

/** The brief span a run's parts belong to: the PR base and the head. */
export interface GenerationSpan {
  readonly pullRequestId: PullRequestRowId;
  readonly baseSha: string;
  readonly headSha: string;
}

export interface GenerationPartWriteInput extends GenerationSpan {
  readonly partKey: PartKey;
  /**
   * The part's body, validated with `GenerationPartBodySchema`. Typed
   * `unknown` because this is the boundary that refuses anything beyond
   * the grouping output or a detail call's attribution.
   */
  readonly body: unknown;
}

export interface GenerationPartRow {
  readonly id: bigint;
  readonly partKey: PartKey;
  readonly body: GenerationPartBody;
  readonly createdAt: Date;
}

export interface GenerationPartStore {
  /** Upserts on the span and key; a foreign parent throws `ScopeViolationError` before any insert. */
  write(input: GenerationPartWriteInput): Promise<GenerationPartRow>;
  /** The span's parts, oldest first, bodies parsed; a stored body off its shape throws `InvalidArtifactBodyError`. */
  listForSpan(span: GenerationSpan): Promise<GenerationPartRow[]>;
  /** Every part of the span; answers how many went. */
  deleteForSpan(span: GenerationSpan): Promise<number>;
}
