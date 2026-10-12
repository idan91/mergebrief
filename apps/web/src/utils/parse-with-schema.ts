import type { z } from "zod/v4";
import type { Result } from "types/utils";

function describeFirstIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  if (issue === undefined) {
    return "invalid";
  }
  const path = issue.path.map(String).join(".");
  if (path === "") {
    return issue.message;
  }
  return `${path}: ${issue.message}`;
}

/** A wire or storage value through its schema; the error names the first issue's path. */
export function parseWithSchema<Output>(
  schema: z.ZodType<Output>,
  value: unknown,
): Result<Output, string> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    return { ok: false, error: describeFirstIssue(parsed.error) };
  }
  return { ok: true, value: parsed.data };
}
