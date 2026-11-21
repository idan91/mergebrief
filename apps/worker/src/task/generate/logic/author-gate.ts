import { isPermanentGitHubError } from "github";
import { createIngestRoutines } from "persistence";
import { isTrustedBot } from "repo-config";
import { GenerationFailureCodes, GenerationStatuses } from "types/generations";
import { buildEntryCommentOnDemandBody } from "../../entry-comment";
import { TransientJobError } from "../../failure";
import { acquireRepoConfig, type AcquiredRepoConfig } from "../../repo-config";
import {
  AuthorGateKinds,
  HeadReadings,
  type AuthorGateOutcome,
  type RunContext,
} from "../types";
import { deriveNextHeadIndex } from "../utils";
import {
  resolveEntryCommentAllowed,
  resolveRunEntryCommentAllowed,
} from "./entry-comment-gate";
import { queueEntrySync, queueEntrySyncOnLostWrite } from "./entry-sync";

const PROCEED_WITHOUT_CONFIG: AuthorGateOutcome = {
  kind: AuthorGateKinds.PROCEED,
  repoConfig: undefined,
};
const AWAITING_TRIGGER: AuthorGateOutcome = {
  kind: AuthorGateKinds.AWAITING_TRIGGER,
};

/**
 * Whether the run may go on to its claim. A head ingest projected
 * `awaiting-trigger` posts the on-demand Entry and ends. A bot PR no
 * collaborator approved goes on only when the default branch's settings list
 * its login; unlisted or unreadable, it is held the same way. A held run
 * claims nothing, records no attempt and reaches no model. A url-box job, a
 * recovery run, a stored brief's run and a succeeded row are never gated.
 */
export async function applyAuthorGate(
  context: RunContext,
): Promise<AuthorGateOutcome> {
  if (!isGateable(context)) {
    return PROCEED_WITHOUT_CONFIG;
  }
  if (context.projected?.status === GenerationStatuses.AWAITING_TRIGGER) {
    if (context.prRow.triggerApprovedAt !== null) {
      await releaseApprovedHold(context);
      return AWAITING_TRIGGER;
    }
    context.log.info("generate: head awaits a trigger approval");
    const allowed = await resolveRunEntryCommentAllowed(context);
    await postOnDemandEntry(context, allowed);
    return AWAITING_TRIGGER;
  }

  const { prInfo, prRow, source, log } = context;
  const owesBotApproval =
    prInfo.authorIsBot && prRow.triggerApprovedAt === null;
  if (!owesBotApproval) {
    return PROCEED_WITHOUT_CONFIG;
  }
  const repoConfig = await acquireRepoConfig(source, log);
  const login = prInfo.authorLogin;
  const listed = login !== null && isTrustedBot(repoConfig.settings, login);
  if (listed) {
    return { kind: AuthorGateKinds.PROCEED, repoConfig };
  }

  throwOnRetryableSettingsRead(context, repoConfig);
  await holdBotRun(context, repoConfig);
  return AWAITING_TRIGGER;
}

/**
 * A settings read a retry may clear could still list the bot, so the run
 * hands it to graphile while attempts remain. A permanent failure, or the
 * last attempt, holds the bot fail-closed.
 */
export function throwOnRetryableSettingsRead(
  context: RunContext,
  repoConfig: AcquiredRepoConfig,
): void {
  const failure = repoConfig.settingsFetchFailure;
  const retryable = failure !== undefined && !isPermanentGitHubError(failure);
  const { job } = context;
  const attemptsLeft = job !== undefined && job.attempts < job.max_attempts;
  const retriesRead = retryable && attemptsLeft;
  if (!retriesRead) {
    return;
  }
  throw new TransientJobError(`settings read failed: ${failure.message}`, {
    failure: { code: GenerationFailureCodes.GITHUB_UNAVAILABLE },
  });
}

function isGateable(context: RunContext): boolean {
  const { payload, recovering, existingBrief, projected } = context;
  const gateable =
    payload.grantId === undefined &&
    !recovering &&
    existingBrief === undefined &&
    projected?.status !== GenerationStatuses.SUCCEEDED;
  return gateable;
}

/**
 * A head held before its PR was approved is the approval's to run: it goes
 * back to `pending` under the PR's row lock and a fresh job runs it, as a
 * Generate click would, while this run stands down without a post.
 */
async function releaseApprovedHold(context: RunContext): Promise<void> {
  const { deps, payload, log } = context;
  const ingest = createIngestRoutines(deps.handle, payload.ctx);
  const released = await ingest.releaseApprovedHold({
    pullRequestId: payload.pullRequestId,
    headSha: payload.headSha,
  });
  log.info("generate: approved PR's held head released", {
    queued: released.queued,
  });
}

/**
 * The hold refuses a row a live run holds, a succeeded row and a PR a
 * collaborator approved since this run read it; the run then stands down
 * without a post, and the approval's own job runs the head.
 */
async function holdBotRun(
  context: RunContext,
  repoConfig: AcquiredRepoConfig,
): Promise<void> {
  const { payload, prInfo, projection, target, entryCommentManager, log } =
    context;
  const held = await projection.markAwaitingTrigger(target);
  if (!held.ok) {
    log.info(`generate: bot run not held, ${held.error.message}`);
    return;
  }
  context.run.leaveRow = true;

  log.info("generate: bot PR awaits a trigger approval");
  const allowed = await resolveEntryCommentAllowed(payload, {
    prInfo,
    repoConfig,
    entryCommentManager,
    log,
  });
  await postOnDemandEntry(context, allowed);
}

/**
 * A click may approve the PR while this run reads GitHub, and the run it
 * queues posts its own generating body, so the row is read again right
 * before the post and a head no longer `awaiting-trigger` is left to it, as
 * is a thread a newer head's run now owns. A post that fails, or stands down
 * on an unread head, queues the head's sync.
 */
async function postOnDemandEntry(
  context: RunContext,
  entryCommentAllowed: boolean,
): Promise<void> {
  const { deps, priorBriefs, projection, target, entryCommentManager, log } =
    context;
  if (!entryCommentAllowed) {
    return;
  }

  const nextHeadLink = entryCommentManager.buildDeepLink(
    deriveNextHeadIndex(priorBriefs),
  );
  const body = buildEntryCommentOnDemandBody(deps.translate, nextHeadLink);
  if (await entryCommentManager.matches(body)) {
    log.info("generate: on-demand entry already live, no re-ping");
    return;
  }
  const current = await projection.get(target);
  if (current?.status !== GenerationStatuses.AWAITING_TRIGGER) {
    log.info("generate: head left awaiting-trigger, on-demand entry skipped");
    return;
  }
  const head = await context.watch.readHead();
  if (head.kind === HeadReadings.MOVED) {
    log.info("generate: head moved, leaving the Entry comment to it");
    return;
  }
  if (head.kind === HeadReadings.UNREAD) {
    log.warn("generate: head unread, the on-demand Entry stands down", {
      error: head.error,
    });
    await queueEntrySync(context);
    return;
  }
  const write = await entryCommentManager.refresh(body);
  await queueEntrySyncOnLostWrite(context, write);
}
