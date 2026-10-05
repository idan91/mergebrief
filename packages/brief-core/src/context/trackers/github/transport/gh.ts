import { z } from "zod/v4";
import { TicketUnreadReasons } from "../../../../types";
import { execFileAsync, MAX_BUFFER } from "../../../../github/exec";
import { isPathSegment } from "../../../../github/pr-url";
import type { ContextReadFailure } from "../../../types";
import {
  readFailureForStatus,
  type GitHubTransport,
  type IssueLocator,
  type IssueRecord,
} from "./port";

/** The exec shape the GH transport needs; tests substitute a fake. */
export type GhExec = (
  file: string,
  args: readonly string[],
  options: { readonly maxBuffer: number; readonly signal: AbortSignal },
) => Promise<{ readonly stdout: string }>;

/** `gh` exits 4 when no account is logged in. */
const GH_EXIT_NOT_LOGGED_IN = 4;
const HTTP_STATUS_IN_STDERR = /\(HTTP (\d{3})\)/;

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

interface ExecFailure {
  readonly name: string;
  readonly code: number | string | undefined;
  readonly stderr: string;
}

function readExecFailure(error: unknown): ExecFailure {
  const failure: {
    name: string;
    code: number | string | undefined;
    stderr: string;
  } = { name: "", code: undefined, stderr: "" };
  if (typeof error !== "object" || error === null) return failure;
  if ("name" in error && typeof error.name === "string") {
    failure.name = error.name;
  }
  if ("code" in error) {
    const code = error.code;
    if (typeof code === "number" || typeof code === "string") {
      failure.code = code;
    }
  }
  if ("stderr" in error && typeof error.stderr === "string") {
    failure.stderr = error.stderr;
  }
  return failure;
}

/** stderr is gh's own wording and may echo request detail: only the status escapes. */
function toGhReadFailure(
  error: unknown,
  signal: AbortSignal,
): ContextReadFailure {
  const failure = readExecFailure(error);
  if (signal.aborted || failure.name === "AbortError") {
    return { reason: TicketUnreadReasons.TIMEOUT, detail: "read aborted" };
  }
  if (failure.code === GH_EXIT_NOT_LOGGED_IN) {
    return {
      reason: TicketUnreadReasons.NO_CREDENTIAL,
      detail: "gh is not logged in",
    };
  }
  if (failure.code === "ENOENT") {
    return {
      reason: TicketUnreadReasons.UNSUPPORTED,
      detail: "gh is not installed",
    };
  }

  // gh reports a primary rate limit as a 403 whose text says so.
  if (/rate limit/i.test(failure.stderr)) {
    return {
      reason: TicketUnreadReasons.RATE_LIMITED,
      detail: "gh reported a rate limit",
    };
  }
  const status = HTTP_STATUS_IN_STDERR.exec(failure.stderr)?.[1];
  if (status !== undefined) return readFailureForStatus(Number(status));
  return {
    reason: TicketUnreadReasons.TIMEOUT,
    detail: `gh exited ${String(failure.code ?? "unknown")}`,
  };
}

function toIssueRecord(raw: unknown): IssueRecord {
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

function isWellFormed(locator: IssueLocator): boolean {
  const segmentsOk =
    isPathSegment(locator.owner) && isPathSegment(locator.repo);
  return segmentsOk && Number.isInteger(locator.number) && locator.number > 0;
}

/**
 * The CLI transport over the user's `gh` login. `gh issue view` answers a
 * PR number with the PR and hides the HTTP status; `gh api` exposes both,
 * so a PR is detectable and a 404 separable from a login failure.
 */
export function createGhTransport(
  execFile: GhExec = execFileAsync,
): GitHubTransport {
  return {
    async readIssue(locator, signal) {
      if (!isWellFormed(locator)) {
        return {
          ok: false,
          error: {
            reason: TicketUnreadReasons.UNSUPPORTED,
            detail: "malformed issue locator",
          },
        };
      }

      const path = `repos/${locator.owner}/${locator.repo}/issues/${locator.number}`;
      let stdout: string;
      try {
        ({ stdout } = await execFile("gh", ["api", path], {
          maxBuffer: MAX_BUFFER,
          signal,
        }));
      } catch (error) {
        return { ok: false, error: toGhReadFailure(error, signal) };
      }

      return { ok: true, value: toIssueRecord(JSON.parse(stdout)) };
    },
  };
}
