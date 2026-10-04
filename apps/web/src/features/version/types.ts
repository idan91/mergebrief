import type { VersionResponse } from "contract";
import type { Mutable, Result, ValueOf } from "types/utils";

import { isRecord } from "@web/utils/typeGuards";

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

const OPTIONAL_STRINGS = [
  "latest",
  "releaseNotesUrl",
  "checkedAt",
  "dismissedVersion",
] as const;
const OPTIONAL_FLAGS = ["breaking", "security"] as const;

/** Tolerant read of the wire body: unknown fields drop, a missing version refuses. */
export function parseVersion(body: unknown): Result<VersionResponse, string> {
  if (!isRecord(body) || typeof body["version"] !== "string") {
    return { ok: false, error: "version is missing" };
  }

  const snapshot: Mutable<VersionResponse> = { version: body["version"] };
  for (const key of OPTIONAL_STRINGS) {
    const value = body[key];
    if (typeof value === "string") {
      snapshot[key] = value;
    }
  }
  for (const key of OPTIONAL_FLAGS) {
    const value = body[key];
    if (typeof value === "boolean") {
      snapshot[key] = value;
    }
  }
  return { ok: true, value: snapshot };
}
