import { z } from "zod/v4";
import type { IssueRecord } from "../../context/trackers/github";

/** Shape of `gh api repos/{owner}/{repo}/issues/{n}` output we rely on. */
const GhIssueSchema = z.object({
  title: z.string(),
  state: z.string(),
  state_reason: z.string().nullish(),
  labels: z
    .array(z.union([z.string(), z.object({ name: z.string().nullish() })]))
    .nullish(),
  milestone: z.object({ title: z.string() }).nullish(),
  body: z.string().nullish(),
  pull_request: z.unknown().optional(),
});

export function toIssueRecord(raw: unknown): IssueRecord {
  const issue = GhIssueSchema.parse(raw);

  const labels: string[] = [];
  for (const label of issue.labels ?? []) {
    const name = typeof label === "string" ? label : (label.name ?? "");
    if (name !== "") labels.push(name);
  }
  return {
    title: issue.title,
    state: issue.state,
    stateReason: issue.state_reason ?? null,
    labels,
    milestone: issue.milestone?.title ?? null,
    body: issue.body ?? "",
    isPullRequest: issue.pull_request !== undefined,
  };
}
