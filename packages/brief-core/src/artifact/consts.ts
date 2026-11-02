import type {
  DeltaSkipped,
  DeltaUnchanged,
  RevisionNarrativeSkipped,
  RevisionNarrativeUnchanged,
} from "../types";

// Bump when a reader here cannot read an older writer's body without a version branch.
export const STORED_BODY_VERSION = 2;

export const DELTA_SKIPPED_KIND: DeltaSkipped["artifactKind"] = "deltaSkipped";

export const DELTA_UNCHANGED_KIND: DeltaUnchanged["artifactKind"] =
  "deltaUnchanged";

export const REVISION_NARRATIVE_UNCHANGED_KIND: RevisionNarrativeUnchanged["artifactKind"] =
  "revisionNarrativeUnchanged";

export const REVISION_NARRATIVE_SKIPPED_KIND: RevisionNarrativeSkipped["artifactKind"] =
  "revisionNarrativeSkipped";
