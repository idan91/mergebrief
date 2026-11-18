import type { VersionResponse } from "contract";
import type { ValueOf } from "types/utils";

export const NoticeSurfaces = {
  HOME: "home",
  BRIEF: "brief",
} as const;
export type NoticeSurface = ValueOf<typeof NoticeSurfaces>;

export const VersionStates = {
  KNOWN: "known",
  SIGNED_OUT: "signed-out",
  UNKNOWN: "unknown",
} as const;
type VersionStateKind = ValueOf<typeof VersionStates>;

/** Milliseconds between polls, or `false` for no poll. */
export type PollInterval = number | false;

export type VersionState =
  | {
      readonly kind: typeof VersionStates.KNOWN;
      readonly snapshot: VersionResponse;
    }
  | { readonly kind: Exclude<VersionStateKind, typeof VersionStates.KNOWN> };
