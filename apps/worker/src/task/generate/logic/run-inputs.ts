import {
  acquireRepoConfig,
  buildRepoConfigOrigin,
  type AcquiredRepoConfig,
} from "../../repo-config";
import {
  RunDecisionKinds,
  type CoreMessageLog,
  type GeneratingRun,
  type RunContext,
  type RunInputs,
} from "../types";
import { getPrLocator } from "../utils";
import { resolveEntryCommentAllowed } from "./entry-comment-gate";
import { throwOnGitHubFailure } from "./errors";
import { buildPrMetadata, recordResolvedStack } from "./pr-metadata";
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
): Promise<RunInputs> {
  const { deps, payload, source, prInfo, prRow, repo, prevBrief, log } =
    context;
  context.watch.startPolling();
  const files = throwOnGitHubFailure(await source.fetchPullRequestFiles());
  const diff = throwOnGitHubFailure(await source.fetchDiff());
  const openPullRequests = await source.listOpenPullRequests();

  const locator = getPrLocator(prRow);
  const meta = buildPrMetadata({ prInfo, files, prRow, openPullRequests, log });
  await recordResolvedStack({ repo, prRow, meta, log, now: new Date() });
  const coreMessageLog: CoreMessageLog = (message) => log.info(message);
  const prevSpanFetch =
    prevBrief === undefined
      ? undefined
      : await source.fetchCompareDiff(prevBrief.headSha, payload.headSha);

  const repoConfig = await acquireRunRepoConfig(context, decision);
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
 * A fresh run reads the default-branch config, failing open with recorded
 * fetch-failed outcomes, and records them before generation so a failed or
 * superseded run keeps them. A draft run over a stored brief reads it for the
 * Entry gate only and records nothing: that config never shaped the brief.
 */
async function acquireRunRepoConfig(
  context: RunContext,
  decision: GeneratingRun,
): Promise<AcquiredRepoConfig | undefined> {
  const fresh = decision.kind === RunDecisionKinds.FRESH;
  if (!fresh && !context.prInfo.draft) {
    return undefined;
  }

  const repoConfig = await acquireRepoConfig(context.source, context.log);
  if (fresh) {
    await context.projection.recordRepoConfig(
      context.target,
      buildRepoConfigOrigin(repoConfig),
    );
  }
  return repoConfig;
}
