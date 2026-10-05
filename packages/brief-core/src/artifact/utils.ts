import type { z } from "zod/v4";
import {
  ArtifactIssueCodes,
  type ArtifactIssue,
  type StoredParse,
} from "./types";

const UNVALIDATABLE_MESSAGE = "Body could not be validated";

export function isRecord(value: unknown): value is Record<string, unknown> {
  const isPlainObject =
    typeof value === "object" && value !== null && !Array.isArray(value);
  return isPlainObject;
}

function toInvalidIssues(error: z.ZodError): ArtifactIssue[] {
  return error.issues.map((issue) => ({
    code: ArtifactIssueCodes.INVALID,
    path: issue.path.join("."),
    message: issue.message,
  }));
}

/**
 * zod spreads one element's issue list into a single call, so a body with a
 * very long invalid list overflows the stack: that `RangeError` is an invalid
 * body. Any other throw is a programmer error and surfaces.
 */
export function parseStored<Stored>(
  schema: z.ZodType<Stored>,
  body: unknown,
): StoredParse<Stored> {
  try {
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return { ok: false, error: toInvalidIssues(parsed.error) };
    }

    return { ok: true, value: parsed.data };
  } catch (error) {
    if (!(error instanceof RangeError)) {
      throw error;
    }

    const code = ArtifactIssueCodes.INVALID;
    const issue = { code, path: "", message: UNVALIDATABLE_MESSAGE };
    return { ok: false, error: [issue] };
  }
}
