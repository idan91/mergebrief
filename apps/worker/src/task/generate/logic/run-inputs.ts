import { MAX_BRIEFED_CHANGED_FILES } from "brief-core/types";
import { GenerationFailureCodes } from "types/generations";

import {
  acquireRepoConfig,
  buildRepoConfigOrigin,
  type AcquiredRepoConfig,
} from "../../repo-config";
import { PermanentJobError } from "../../failure";
import { SINGLE_CALL_MAX_DIFF_BYTES } from "../consts";
import {
  RunDecisionKinds,
  type CoreMessageLog,
  type GeneratingRun,
  type RunContext,
  type RunInputs,
} from "../types";
import { getPrLocator } from "../utils";
import { resolveEntryCommentAllowed } from "./entry-comment-gate";
import { isNotAcceptable, throwOnGitHubFailure } from "./errors";
import { buildPrMetadata, recordResolvedStack } from "./pr-metadata";
import { throwOnClaimLost } from "./supersession-watch";
import { createTicketContextLoader } from "./ticket-context";

/**
 * Start the head polls and read what every artifact is built from. The
 * prevHead...head span is fetched before the model call because the anchoring
 * plan needs it; its unwrap stays deferred so a permanent 406 still lands
 * after the brief write.
 */
export async function prepareRunInputs(
  context: RunContext,
  decision: GeneratingRun,
  gateRepoConfig?: AcquiredRepoConfig,
): Promise<RunInputs> {
  const { deps, payload, source, prInfo, prRow, repo, prevBrief, log } =
    context;
  context.watch.startPolling();
  const files = throwOnGitHubFailure(await source.fetchPullRequestFiles());
  const diff = await readPullRequestDiff(context);
  const openPullRequests = await source.listOpenPullRequests();

  const locator = getPrLocator(prRow);
  const meta = buildPrMetadata({ prInfo, files, prRow, openPullRequests, log });
  await recordResolvedStack({ repo, prRow, meta, log, now: new Date() });
  const coreMessageLog: CoreMessageLog = (message) => log.info(message);
  const prevSpanFetch =
    prevBrief === undefined
      ? undefined
      : await source.fetchCompareDiff(prevBrief.headSha, payload.headSha);

  const repoConfig = await acquireRunRepoConfig(
    context,
    decision,
    gateRepoConfig,
  );
  const loadContext = createTicketContextLoader(payload, {
    deps,
    source,
    prInfo,
    locator,
    meta,
    repoConfig,
    coreMessageLog,
    log,
  });
  const entryCommentAllowed = await resolveEntryCommentAllowed(payload, {
    prInfo,
    repoConfig,
    entryCommentManager: context.entryCommentManager,
    log,
  });

  return {
    files,
    diff,
    locator,
    meta,
    prevSpanFetch,
    repoConfig,
    loadContext,
    entryCommentAllowed,
    coreMessageLog,
  };
}

/**
 * GitHub's PR diff refuses past its size limits with a 406; the compare diff
 * of the same base...head span has no file cap. MergeBrief stops at
 * MAX_BRIEFED_CHANGED_FILES and trusts the compare diff only when it holds
 * every file the PR changes. The brief is one model call, so a compare diff
 * past that call's budget fails as too large: the provider would refuse it
 * with a 400 that reads as a generator configuration error.
 */
async function readPullRequestDiff(context: RunContext): Promise<string> {
  const { source, prInfo, payload } = context;
  const diff = await source.fetchDiff();
  const isPastPullRequestLimit = !diff.ok && isNotAcceptable(diff.error);
  const canReadCompareDiff =
    isPastPullRequestLimit && prInfo.changedFiles <= MAX_BRIEFED_CHANGED_FILES;
  if (!canReadCompareDiff) {
    return throwOnGitHubFailure(diff);
  }

  const compare = await source.fetchCheckedCompareDiff(
    prInfo.baseSha,
    payload.headSha,
    prInfo.changedFiles,
  );
  const compareDiff = throwOnGitHubFailure(compare);
  if (Buffer.byteLength(compareDiff, "utf8") > SINGLE_CALL_MAX_DIFF_BYTES) {
    throw new PermanentJobError("compare diff exceeds one model call", {
      failure: { code: GenerationFailureCodes.DIFF_TOO_LARGE },
    });
  }
  return compareDiff;
}

/**
 * A fresh run reads the default-branch config, failing open with recorded
 * fetch-failed outcomes, and records them before generation so a failed or
 * superseded run keeps them. A draft run over a stored brief reads it for the
 * Entry gate only and records nothing: that config never shaped the brief.
 * The config the author gate already read is reused, never fetched twice.
 */
async function acquireRunRepoConfig(
  context: RunContext,
  decision: GeneratingRun,
  gateRepoConfig: AcquiredRepoConfig | undefined,
): Promise<AcquiredRepoConfig | undefined> {
  const fresh = decision.kind === RunDecisionKinds.FRESH;
  if (!fresh && !context.prInfo.draft) {
    return undefined;
  }

  const repoConfig =
    gateRepoConfig ?? (await acquireRepoConfig(context.source, context.log));
  if (decision.kind === RunDecisionKinds.FRESH) {
    const recorded = await context.projection.recordRepoConfig(
      context.target,
      decision.runId,
      buildRepoConfigOrigin(repoConfig),
    );
    throwOnClaimLost(recorded);
  }
  return repoConfig;
}
