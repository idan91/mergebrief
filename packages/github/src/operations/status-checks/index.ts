import { RequestError, type Octokit } from "octokit";
import type { z } from "zod/v4";
import { HttpStatuses } from "types/http";
import type { Mutable, Result } from "types/utils";
import {
  mapRequestError,
  unexpectedResponseError,
  type GitHubApiError,
} from "../../errors";
import {
  branchRuleListSchema,
  checkRunListSchema,
  commitStatusListSchema,
  requiredStatusChecksParametersSchema,
} from "./schemas";
import type { BranchRef, CheckRun, CommitRef, CommitStatus } from "./types";

const PER_PAGE = 100;
/** A check run's `status` once it has finished, whatever its conclusion. */
export const CHECK_RUN_COMPLETED_STATUS = "completed";
const REQUIRED_STATUS_CHECKS_RULE = "required_status_checks";
/** GitHub Free answers a private repository's rules read with a 403 asking for an upgrade. */
const UPGRADE_REQUIRED_PATTERN = /\bupgrade\b/i;

type CheckRunEntry = z.infer<typeof checkRunListSchema>[number];
type CommitStatusEntry = z.infer<typeof commitStatusListSchema>[number];

function shapeCheckRun(entry: CheckRunEntry): CheckRun {
  const completed = entry.status === CHECK_RUN_COMPLETED_STATUS;
  const run: Mutable<CheckRun> = {
    checkRunId: BigInt(entry.id),
    name: entry.name,
    completed,
  };
  if (typeof entry.app?.id === "number") {
    run.appId = BigInt(entry.app.id);
  }
  if (completed && typeof entry.conclusion === "string") {
    run.conclusion = entry.conclusion;
  }
  if (typeof entry.output?.title === "string") {
    run.title = entry.output.title;
  }
  if (typeof entry.output?.text === "string") {
    run.text = entry.output.text;
  }
  return run;
}

function shapeCommitStatus(entry: CommitStatusEntry): CommitStatus {
  const status: Mutable<CommitStatus> = {
    context: entry.context,
    state: entry.state,
  };
  if (typeof entry.creator?.id === "number") {
    status.creatorId = BigInt(entry.creator.id);
  }
  return status;
}

/**
 * Every check run on the commit, reruns included (`filter: all`), so a caller
 * picks the latest per name itself. An entry that will not parse fails the
 * answer: a skipped run could be the one the caller waits on.
 */
export async function listCheckRuns(
  octokit: Octokit,
  ref: CommitRef,
): Promise<Result<CheckRun[], GitHubApiError>> {
  const context = "list check runs";
  try {
    const listed = await octokit.paginate(octokit.rest.checks.listForRef, {
      owner: ref.owner,
      repo: ref.repo,
      ref: ref.ref,
      filter: "all",
      per_page: PER_PAGE,
    });
    const parsed = checkRunListSchema.safeParse(listed);
    if (!parsed.success) {
      return { ok: false, error: unexpectedResponseError(context) };
    }
    return { ok: true, value: parsed.data.map(shapeCheckRun) };
  } catch (error) {
    return { ok: false, error: mapRequestError(error, context) };
  }
}

/** Every status posted on the commit, newest first, as GitHub lists them. */
export async function listCommitStatuses(
  octokit: Octokit,
  ref: CommitRef,
): Promise<Result<CommitStatus[], GitHubApiError>> {
  const context = "list commit statuses";
  try {
    const listed = await octokit.paginate(
      octokit.rest.repos.listCommitStatusesForRef,
      { owner: ref.owner, repo: ref.repo, ref: ref.ref, per_page: PER_PAGE },
    );
    const parsed = commitStatusListSchema.safeParse(listed);
    if (!parsed.success) {
      return { ok: false, error: unexpectedResponseError(context) };
    }
    return { ok: true, value: parsed.data.map(shapeCommitStatus) };
  } catch (error) {
    return { ok: false, error: mapRequestError(error, context) };
  }
}

function isUpgradeRequired(error: unknown): boolean {
  const refused =
    error instanceof RequestError && error.status === HttpStatuses.FORBIDDEN;
  const upgradeRequired =
    refused && UPGRADE_REQUIRED_PATTERN.test(error.message);
  return upgradeRequired;
}

function collectRequiredContexts(
  rules: readonly unknown[],
): string[] | undefined {
  const parsed = branchRuleListSchema.safeParse(rules);
  if (!parsed.success) {
    return undefined;
  }

  const contexts = new Set<string>();
  for (const rule of parsed.data) {
    if (rule.type !== REQUIRED_STATUS_CHECKS_RULE) {
      continue;
    }
    const parameters = requiredStatusChecksParametersSchema.safeParse(
      rule.parameters,
    );
    if (!parameters.success) {
      return undefined;
    }
    for (const check of parameters.data.required_status_checks) {
      contexts.add(check.context);
    }
  }
  return [...contexts];
}

/**
 * The status check names the branch's rulesets require, each once. Classic
 * branch protection is not read. A private repository on GitHub Free has no
 * rulesets to enforce, and its 403 reads as nothing required.
 */
export async function listRequiredStatusChecks(
  octokit: Octokit,
  ref: BranchRef,
): Promise<Result<string[], GitHubApiError>> {
  const context = "list branch rules";
  try {
    const rules = await octokit.paginate(octokit.rest.repos.getBranchRules, {
      owner: ref.owner,
      repo: ref.repo,
      branch: ref.branch,
      per_page: PER_PAGE,
    });
    const contexts = collectRequiredContexts(rules);
    if (contexts === undefined) {
      return { ok: false, error: unexpectedResponseError(context) };
    }
    return { ok: true, value: contexts };
  } catch (error) {
    if (isUpgradeRequired(error)) {
      return { ok: true, value: [] };
    }
    return { ok: false, error: mapRequestError(error, context) };
  }
}
