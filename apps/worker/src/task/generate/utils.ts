import type { Brief, PrLocator } from "brief-core";
import {
  ArtifactIssueCodes,
  isCompleteBrief,
  readStoredBrief,
  type ArtifactIssue,
  type StoredBrief,
} from "brief-core/artifact";
import type { Anchor } from "generators";
import type { Logger } from "logging";
import {
  GenerationKinds,
  StoredIdsSchema,
  type GenerationTarget,
  type PullRequestRow,
} from "persistence";
import { AnchorStates } from "types/generations";
import { PermanentJobError } from "../failure";
import { splitRepoSlug } from "../github-port";
import type { ParsedGeneratePayload } from "../payload";
import {
  BriefRecoveryFailures,
  type AnchorColumns,
  type CompleteBriefRecovery,
  type GenerationOrigin,
  type StoredBodyRecovery,
} from "./types";

/**
 * Artifact origin data from the engine's `Generation` metadata. `effort` is
 * null for adapters without an effort knob; the store column is a plain
 * string, so null normalizes to the honest "none".
 */
export function getGenerationOrigin(
  generation: Brief["generation"],
): GenerationOrigin {
  return {
    provider: generation.provider,
    model: generation.model,
    effort: generation.effort ?? "none",
  };
}

export function getAnchorColumns(anchor: Anchor): AnchorColumns {
  const columns: AnchorColumns = { anchorState: anchor.state };

  if (anchor.state === AnchorStates.FRESH_RESTART) {
    columns.anchorReason = anchor.reason;
  }

  return columns;
}

export function getBriefTarget(
  payload: ParsedGeneratePayload,
): GenerationTarget {
  return {
    pullRequestId: payload.pullRequestId,
    kind: GenerationKinds.BRIEF,
    headSha: payload.headSha,
    baselineSha: null,
  };
}

const UNEXPECTED_SHAPE_WARNING =
  "generate: stored brief body has an unexpected shape — narrative skipped";
const NOT_JSON_WARNING =
  "generate: stored brief body is not valid JSON — narrative skipped";

/** Inert boundary logger for direct test invocations that pass no `log`. */
export function createNoopLogger(): Logger {
  const inert: Logger = {
    error: () => {},
    warn: () => {},
    info: () => {},
    debug: () => {},
    child: () => inert,
  };
  return inert;
}

/**
 * Every group id the PR's chain has used, read off the previous row. NULL
 * (a row predating the column) heals from the stored body's groups, never
 * the empty set while a previous brief reads. The heal needs the groups
 * only, so a body missing its stamped sections still heals.
 */
export function resolveChainGroupIds(
  prevRow: { usedGroupIds: string | null } | undefined,
  previousBody: StoredBrief | undefined,
): readonly string[] {
  if (prevRow !== undefined && prevRow.usedGroupIds !== null) {
    const parsed = StoredIdsSchema.safeParse(prevRow.usedGroupIds);
    if (parsed.success) return parsed.data;
  }
  return previousBody?.changeGroups.map((group) => group.id) ?? [];
}

/** A broken body can report one issue per element. */
const MAX_LOGGED_READ_ISSUES = 20;

function logReadIssues(issues: readonly ArtifactIssue[], log: Logger): void {
  for (const issue of issues.slice(0, MAX_LOGGED_READ_ISSUES)) {
    log.debug("generate: stored brief body issue", {
      code: issue.code,
      path: issue.path,
    });
  }
}

/** The reader's value whenever the body reads, stamped sections or not. */
export function recoverStoredBody(
  body: string,
  log: Logger,
): StoredBodyRecovery {
  const read = readStoredBrief(body);
  if (!read.ok) {
    logReadIssues(read.error, log);
    const notJson = read.error.some(
      (issue) => issue.code === ArtifactIssueCodes.NOT_JSON,
    );
    log.warn(notJson ? NOT_JSON_WARNING : UNEXPECTED_SHAPE_WARNING);
    return read;
  }

  logReadIssues(read.value.issues, log);
  return { ok: true, value: read.value.brief };
}

/** The stored body as a full Brief, or a warning when a stamped section is gone. */
export function recoverCompleteBrief(
  stored: StoredBrief,
  log: Logger,
): CompleteBriefRecovery {
  const isComplete = isCompleteBrief(stored);
  if (!isComplete) {
    log.warn(UNEXPECTED_SHAPE_WARNING);
    return { ok: false, error: BriefRecoveryFailures.INCOMPLETE };
  }

  return { ok: true, value: stored };
}

export function recoverBrief(body: string, log: Logger): CompleteBriefRecovery {
  const stored = recoverStoredBody(body, log);
  if (!stored.ok) {
    return { ok: false, error: BriefRecoveryFailures.UNREADABLE };
  }

  return recoverCompleteBrief(stored.value, log);
}

export function getPrLocator(pr: PullRequestRow): PrLocator {
  const split = splitRepoSlug(pr.repoSlug ?? "");
  if (split === undefined) {
    throw new PermanentJobError("pull_request row has no usable repo slug");
  }
  return { owner: split.owner, repo: split.repo, number: pr.prNumber };
}
