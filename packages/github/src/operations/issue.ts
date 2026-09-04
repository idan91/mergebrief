// Issue read primitive: the fields the ticket-alignment read shows the model.
// Failures are sanitized via `mapRequestError`.
import type { Octokit } from "octokit";
import { mapRequestError, type GitHubApiError } from "../errors";
import type { Result } from "../types";

export interface IssueRef {
  readonly owner: string;
  readonly repo: string;
  readonly number: number;
}

export interface IssueInfo {
  readonly title: string;
  /** GitHub issue state (`open` / `closed`). */
  readonly state: string;
  /** `completed` / `not_planned` / `reopened` / `duplicate`; null while open. */
  readonly stateReason: string | null;
  readonly labels: readonly string[];
  /** Milestone title; null when unset. */
  readonly milestone: string | null;
  /** Issue body; GitHub sends null for an empty body. */
  readonly body: string;
  /** The payload carries `pull_request`: a PR shares the issue number space. */
  readonly isPullRequest: boolean;
}

type IssueLabel = string | { readonly name?: string | null | undefined };

function readLabelName(label: IssueLabel): string {
  if (typeof label === "string") return label;
  return label.name ?? "";
}

/** Fetch one issue by number. A PR number resolves too; see `isPullRequest`. */
export async function fetchIssue(
  octokit: Octokit,
  ref: IssueRef,
): Promise<Result<IssueInfo, GitHubApiError>> {
  try {
    const response = await octokit.rest.issues.get({
      owner: ref.owner,
      repo: ref.repo,
      issue_number: ref.number,
    });
    const data = response.data;

    const labels = data.labels.map(readLabelName).filter((name) => name !== "");
    return {
      ok: true,
      value: {
        title: data.title,
        state: data.state,
        stateReason: data.state_reason ?? null,
        labels,
        milestone: data.milestone?.title ?? null,
        body: data.body ?? "",
        isPullRequest: data.pull_request !== undefined,
      },
    };
  } catch (error) {
    return { ok: false, error: mapRequestError(error, "fetch issue") };
  }
}
