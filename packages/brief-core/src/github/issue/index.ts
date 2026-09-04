import type { Result } from "types";
import type {
  IssueLocator,
  IssueReader,
  IssueRecord,
} from "../../context/trackers/github";
import type { ContextReadFailure } from "../../context/types";
import { TicketUnreadReasons } from "../../types";
import { execFileAsync, MAX_BUFFER, SEGMENT } from "../exec";
import { toReadFailure } from "./failures";
import { toIssueRecord } from "./record";

/** The exec shape the reader needs; tests substitute a fake. */
export type GhExec = (
  file: string,
  args: readonly string[],
  options: { readonly maxBuffer: number; readonly signal: AbortSignal },
) => Promise<{ readonly stdout: string }>;

/** `.` and `..` pass the segment grammar but would walk the `gh api` path. */
function isPathSegment(value: string): boolean {
  return SEGMENT.test(value) && value !== "." && value !== "..";
}

function isWellFormed(locator: IssueLocator): boolean {
  const segmentsOk =
    isPathSegment(locator.owner) && isPathSegment(locator.repo);
  return segmentsOk && Number.isInteger(locator.number) && locator.number > 0;
}

/**
 * The CLI reader. `gh issue view` answers a PR number with the PR and hides
 * the HTTP status; `gh api` exposes both, so a PR is detectable and a 404
 * separable from a login failure.
 */
export function createGhIssueReader(
  execFile: GhExec = execFileAsync,
): IssueReader {
  return {
    async readIssue(
      locator: IssueLocator,
      signal: AbortSignal,
    ): Promise<Result<IssueRecord, ContextReadFailure>> {
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
        return { ok: false, error: toReadFailure(error, signal) };
      }

      return { ok: true, value: toIssueRecord(JSON.parse(stdout)) };
    },
  };
}

/** The default CLI reader over the real `gh` binary. */
export const ghIssueReader: IssueReader = createGhIssueReader();
