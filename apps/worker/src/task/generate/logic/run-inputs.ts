import { MAX_BRIEFED_CHANGED_FILES } from "brief-core/types";
import { isNotAcceptable, type PullRequestFile } from "github";

import {
  acquireRepoConfig,
  buildRepoConfigOrigin,
  type AcquiredRepoConfig,
} from "../../repo-config";
import {
  RunDecisionKinds,
  type CoreMessageLog,
  type GeneratingRun,
  type PreClaimReads,
  type RunContext,
  type RunInputs,
} from "../types";
import { getPrLocator } from "../utils";
import { resolveEntryCommentAllowed } from "./entry-comment-gate";
import { throwOnGitHubFailure } from "./errors";
import { buildPrMetadata, recordResolvedStack } from "./pr-metadata";
import { createRevisionSpanReader } from "./revision-span";
import { throwOnClaimLost } from "./supersession-watch";
import { createTicketContextLoader } from "./ticket-context";

/**
 * Start the head polls and read what every artifact is built from. The
 * revision span is read here, before any model call, because the anchoring
 * plan needs it and a transient failure must retry before spend.
 */
export async function prepareRunInputs(
  context: RunContext,
  decision: GeneratingRun,
  reads: PreClaimReads,
): Promise<RunInputs> {
  const { deps, payload, source, prInfo, prRow, repo, prevBrief, log } =
    context;
  context.watch.startPolling();
  const files = await readPullRequestFiles(context, reads.files);
  const diff = await readPullRequestDiff(context);
  const openPullRequests = await source.listOpenPullRequests();

  const locator = getPrLocator(prRow);
  const meta = buildPrMetadata({ prInfo, files, prRow, openPullRequests, log });
  await recordResolvedStack({ repo, prRow, meta, log, now: new Date() });
  const coreMessageLog: CoreMessageLog = (message) => log.info(message);
  const prevSpanRead =
    prevBrief === undefined
      ? undefined
      : await createRevisionSpanReader(context)(prevBrief);

  const repoConfig = await acquireRunRepoConfig(
    context,
    decision,
    reads.repoConfig,
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
    prevSpanRead,
    repoConfig,
    loadContext,
    entryCommentAllowed,
    coreMessageLog,
  };
}

/** The list a `paths` condition read before the claim, else a fresh read. */
async function readPullRequestFiles(
  context: RunContext,
  checkedFiles: readonly PullRequestFile[] | undefined,
): Promise<PullRequestFile[]> {
  if (checkedFiles !== undefined) {
    return [...checkedFiles];
  }
  return throwOnGitHubFailure(await context.source.fetchPullRequestFiles());
}

/**
 * GitHub's PR diff refuses past its size limits with a 406; the compare diff
 * of the same base...head span has no file cap. MergeBrief stops at
 * MAX_BRIEFED_CHANGED_FILES and trusts the compare diff only when it holds
 * every file the PR changes.
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
  return throwOnGitHubFailure(compare);
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
