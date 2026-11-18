import type { ValueOf } from "types/utils";

/** The Media a failed row stands in for; a diagram falls back to its source instead. */
export const MediaFailedRowKinds = {
  IMAGE: "image",
  VIDEO: "video",
} as const;
export type MediaFailedRowKind = ValueOf<typeof MediaFailedRowKinds>;

/** Why the row stands in: the Media failed to load, or sits on an outside host. */
export const MediaFailedRowStates = {
  FAILED: "failed",
  OUTSIDE: "outside",
} as const;
export type MediaFailedRowState = ValueOf<typeof MediaFailedRowStates>;

export interface MediaFailedRowLink {
  readonly href: string;
  readonly label: string;
}

/** What one row shows, resolved from its props. */
export interface MediaFailedRowContent {
  readonly state: MediaFailedRowState;
  readonly wording: string;
  /** Read out beside an author's alt text, which says nothing of the failure. */
  readonly iconLabel: string | undefined;
  readonly link: MediaFailedRowLink | undefined;
}

export interface MediaFailedRowInput {
  readonly kind: MediaFailedRowKind;
  readonly alt: string | undefined;
  readonly originalAddress: string | undefined;
  readonly outsideHost: string | undefined;
}
