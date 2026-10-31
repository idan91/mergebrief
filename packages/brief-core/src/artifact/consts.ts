import type { DeltaSkipped } from "../types";

// Bump when a reader here cannot read an older writer's body without a version branch.
export const STORED_BODY_VERSION = 2;

export const DELTA_SKIPPED_KIND: DeltaSkipped["artifactKind"] = "deltaSkipped";
