import type { ValueOf } from "types/utils";

export const ProvenanceKinds = {
  TICKET: "ticket",
  HANDLE: "handle",
  PULL_REQUEST: "pull-request",
} as const;

export type ProvenanceKind = ValueOf<typeof ProvenanceKinds>;

export interface ProvenanceHit {
  readonly path: string;
  readonly line: number;
  readonly kind: ProvenanceKind;
  readonly match: string;
}

export interface ProvenancePattern {
  readonly kind: ProvenanceKind;
  readonly pattern: RegExp;
}
