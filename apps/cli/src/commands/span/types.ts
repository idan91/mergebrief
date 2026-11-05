import type { BriefSpan } from "../../types";

export const SpanSelectionKinds = {
  /** `--base`/`--head`: no read, no record, no notice. */
  EXPLICIT: "explicit",
  /** `--revision <n>`. */
  NUMBERED: "numbered",
  /** No span flags. */
  LATEST: "latest",
} as const;

export interface ExplicitSpanSelection {
  readonly kind: typeof SpanSelectionKinds.EXPLICIT;
  readonly span: BriefSpan;
}

export interface NumberedSpanSelection {
  readonly kind: typeof SpanSelectionKinds.NUMBERED;
  readonly headIndex: number;
}

export interface LatestSpanSelection {
  readonly kind: typeof SpanSelectionKinds.LATEST;
}

export type SpanSelection =
  | ExplicitSpanSelection
  | NumberedSpanSelection
  | LatestSpanSelection;

export interface SpanFlags {
  readonly base?: string | undefined;
  readonly head?: string | undefined;
  readonly revision?: string | undefined;
}
