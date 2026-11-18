import type { AppDatabase, ReviewerId } from "persistence";
import type { ValueOf } from "types/utils";
import type { VersionSnapshot } from "../../update-check";

/** Narrow slices only, never `AppDeps`. */
export interface VersionControllerDeps {
  readonly handle: AppDatabase;
  /** The release check's cached answer. */
  readonly readSnapshot: () => VersionSnapshot;
}

export interface ReadVersionInput {
  readonly reviewerId: ReviewerId;
}

export interface DismissVersionInput {
  readonly reviewerId: ReviewerId;
  readonly version: string;
}

/** Why a dismiss is refused: only the known latest, and never a security release. */
export const DismissRefusals = {
  NOT_LATEST: "not-latest",
  SECURITY_RELEASE: "security-release",
} as const;
export type DismissRefusal = ValueOf<typeof DismissRefusals>;
