import type { z } from "zod/v4";
import type { Result } from "types/utils";
import { DeltaBriefSchema } from "../types";
import {
  buildStoredBriefSchema,
  StoredRevisionNarrativeSchema,
} from "./schemas";
import {
  ArtifactIssueCodes,
  type ArtifactIssue,
  type BriefWriteCheck,
  type DeltaBriefWriteCheck,
  type RevisionNarrativeWriteCheck,
} from "./types";

export {
  ArtifactIssueCodes,
  type ArtifactIssue,
  type ArtifactIssueCode,
  type BriefWriteCheck,
  type DeltaBriefWriteCheck,
  type RevisionNarrativeWriteCheck,
  type StoredRevisionNarrative,
} from "./types";

function toInvalidIssues(error: z.ZodError): ArtifactIssue[] {
  return error.issues.map((issue) => ({
    code: ArtifactIssueCodes.INVALID,
    path: issue.path.join("."),
    message: issue.message,
  }));
}

function checkForWrite<Stored>(
  schema: z.ZodType<Stored>,
  body: unknown,
): Result<Stored, ArtifactIssue[]> {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return { ok: false, error: toInvalidIssues(parsed.error) };
  }

  return { ok: true, value: parsed.data };
}

/** Accepts the built-in risk names plus the repo's `customNames`. */
export function checkBriefForWrite(
  brief: unknown,
  customNames: readonly string[],
): BriefWriteCheck {
  return checkForWrite(buildStoredBriefSchema(customNames), brief);
}

export function checkDeltaBriefForWrite(delta: unknown): DeltaBriefWriteCheck {
  return checkForWrite(DeltaBriefSchema, delta);
}

export function checkRevisionNarrativeForWrite(
  body: unknown,
): RevisionNarrativeWriteCheck {
  return checkForWrite(StoredRevisionNarrativeSchema, body);
}
