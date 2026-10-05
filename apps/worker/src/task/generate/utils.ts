import type { Brief, PrLocator } from "brief-core";
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
import type { AnchorColumns, GenerationOrigin } from "./types";

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
 * Structural guard for a stored brief body. The body was schema-validated at
 * generation time and written by us, so this only defends against the row
 * predating a shape change, checked structurally (never a bare cast).
 */
function isBrief(value: unknown): value is Brief {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate: Record<string, unknown> = { ...value };
  const hasBriefShape =
    typeof candidate["summary"] === "string" &&
    Array.isArray(candidate["changeGroups"]) &&
    Array.isArray(candidate["chunks"]) &&
    typeof candidate["pr"] === "object" &&
    candidate["pr"] !== null &&
    typeof candidate["generation"] === "object" &&
    candidate["generation"] !== null;
  return hasBriefShape;
}

/**
 * Every group id the PR's chain has used, read off the previous row. NULL
 * (a row predating the column) heals from the recovered body's groups,
 * never the empty set while a previous brief exists.
 */
export function resolveChainGroupIds(
  prevRow: { usedGroupIds: string | null } | undefined,
  previousBody: Brief | undefined,
): readonly string[] {
  if (prevRow !== undefined && prevRow.usedGroupIds !== null) {
    const parsed = StoredIdsSchema.safeParse(prevRow.usedGroupIds);
    if (parsed.success) return parsed.data;
  }
  return previousBody?.changeGroups.map((group) => group.id) ?? [];
}

export function recoverBrief(body: string, log: Logger): Brief | undefined {
  try {
    const parsed: unknown = JSON.parse(body);
    if (isBrief(parsed)) {
      return parsed;
    }
    log.warn(
      "generate: stored brief body has an unexpected shape — narrative skipped",
    );
    return undefined;
  } catch {
    log.warn(
      "generate: stored brief body is not valid JSON — narrative skipped",
    );
    return undefined;
  }
}

export function getPrLocator(pr: PullRequestRow): PrLocator {
  const split = splitRepoSlug(pr.repoSlug ?? "");
  if (split === undefined) {
    throw new PermanentJobError("pull_request row has no usable repo slug");
  }
  return { owner: split.owner, repo: split.repo, number: pr.prNumber };
}
